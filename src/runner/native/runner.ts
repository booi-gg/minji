import guestSource from "../guest.js?raw";
import { emptyResult, toRawResult, type GuestOutput } from "../guest-output.ts";
import { buildLoaderBody, guestConfigFor } from "../invocation.ts";
import { RunSession, runBudgetMs } from "../session.ts";
import { transformSource } from "../transform.ts";
import type { RunRequest, Runner, RunnerEvent } from "../types.ts";

const DEFAULT_RUNNER_URL = "/runner.html";
const FRAME_LOAD_TIMEOUT_MS = 10_000;

type FrameMessage =
  | { type: "ready" }
  | { type: "started"; runId: string }
  | { type: "run-complete"; runId: string }
  | {
      type: "test-output";
      runId: string;
      testId: string;
      outcome: "output" | "timeout" | "syntax-error" | "error";
      text?: string;
      message?: string;
    };

export interface NativeRunnerOptions {
  url?: string;
  /** Overrides the watchdog budget; tests use it to reach the watchdog quickly. */
  runBudgetMs?: (request: RunRequest) => number;
}

const isFrameMessage = (data: unknown): data is FrameMessage =>
  typeof data === "object" && data !== null && "type" in data && typeof data.type === "string";

/**
 * The Worker script is the same for every run: the harness plus a handler that receives one
 * test, signals the start (so the deadline excludes Worker startup), compiles the user's
 * code with `new Function` so syntax errors are catchable in every engine, and runs it.
 */
const WORKER_SOURCE = [
  guestSource,
  "self.onmessage = function (event) {",
  "  self.onmessage = null;",
  "  var data = event.data;",
  '  self.postMessage({ __minji: "start" });',
  "  var load;",
  "  try {",
  '    load = new Function("exports", "module", "require", data.body);',
  "  } catch (error) {",
  '    self.postMessage({ __minji: "syntax-error", message: String(error && error.message) });',
  "    return;",
  "  }",
  '  self.postMessage({ __minji: "output", text: __minjiRun(load, data.argsJson, data.config) });',
  "};",
].join("\n");

/**
 * Candidate B: a native Worker per test, created inside an opaque-origin sandboxed iframe
 * with a strict CSP. See specs/runner.md.
 */
export const createNativeRunner = (options: NativeRunnerOptions = {}): Runner => {
  const url = options.url ?? DEFAULT_RUNNER_URL;
  const budgetFor = options.runBudgetMs ?? runBudgetMs;
  let frame: HTMLIFrameElement | undefined;
  let frameReady: Promise<HTMLIFrameElement> | undefined;
  let session: RunSession | undefined;
  let onFrameMessage: ((message: FrameMessage) => void) | undefined;

  const listener = (event: MessageEvent): void => {
    if (frame === undefined || event.source !== frame.contentWindow) return;
    if (isFrameMessage(event.data)) onFrameMessage?.(event.data);
  };
  window.addEventListener("message", listener);

  const removeFrame = (): void => {
    frame?.remove();
    frame = undefined;
    frameReady = undefined;
  };

  const ensureFrame = (): Promise<HTMLIFrameElement> => {
    frameReady ??= new Promise((resolve, reject) => {
      const element = document.createElement("iframe");
      element.sandbox.add("allow-scripts");
      element.hidden = true;
      element.title = "Code runner";
      element.src = url;
      const timer = setTimeout(
        () => reject(new Error("The runner frame didn't load.")),
        FRAME_LOAD_TIMEOUT_MS,
      );
      onFrameMessage = (message) => {
        if (message.type !== "ready") return;
        clearTimeout(timer);
        resolve(element);
      };
      frame = element;
      document.body.append(element);
    });
    return frameReady;
  };

  const handle = (current: RunSession, message: FrameMessage): void => {
    if (message.type === "ready" || message.runId !== current.request.runId) return;
    switch (message.type) {
      case "started":
        current.startWatchdog(budgetFor(current.request), () => {
          removeFrame();
          current.crash("watchdog", "The runner stopped responding and was restarted.");
        });
        return;
      case "run-complete":
        current.complete(false);
        return;
      case "test-output":
        handleTestOutput(current, message);
        return;
      default:
        message satisfies never;
    }
  };

  const handleTestOutput = (
    current: RunSession,
    message: Extract<FrameMessage, { type: "test-output" }>,
  ): void => {
    const { testId } = message;
    if (message.outcome === "timeout") {
      current.result(emptyResult(testId, "timeout", { durationMs: current.request.testTimeoutMs }));
      return;
    }
    if (message.outcome === "syntax-error") {
      // The code doesn't parse, so every test would fail the same way. Removing the frame
      // also ends the iframe's loop over the remaining tests.
      removeFrame();
      current.compileError(message.message ?? "Syntax error");
      return;
    }
    if (message.outcome === "error") {
      const text = message.message ?? "Worker error";
      const kind = /memory/i.test(text) ? "memory-limit" : "threw";
      current.result(emptyResult(testId, kind, { error: { name: "Error", message: text } }));
      return;
    }
    const mapped = toRawResult(testId, JSON.parse(message.text ?? "{}") as GuestOutput);
    if (mapped.type === "imports-unsupported") {
      removeFrame();
      current.importsUnsupported(mapped.specifier);
      return;
    }
    current.result(mapped.result);
  };

  const start = async (current: RunSession): Promise<void> => {
    const { request } = current;
    const transformed = transformSource(request.source, request.language);
    if (!transformed.ok) {
      current.compileError(transformed.message, transformed.line, transformed.column);
      return;
    }
    const body = buildLoaderBody(transformed.code, request.functionName);
    const element = await ensureFrame();
    onFrameMessage = (message) => handle(current, message);
    element.contentWindow?.postMessage(
      {
        type: "run",
        runId: request.runId,
        workerSource: WORKER_SOURCE,
        body,
        testTimeoutMs: request.testTimeoutMs,
        tests: request.tests.map((test) => ({
          id: test.id,
          argsJson: test.argsJson,
          config: guestConfigFor(test),
        })),
      },
      "*",
    );
  };

  return {
    run(request: RunRequest, onEvent: (event: RunnerEvent) => void): Promise<void> {
      if (session !== undefined && !session.ended) {
        return Promise.reject(new Error("A run is already in progress."));
      }
      return new Promise((resolve) => {
        const current = new RunSession(request, onEvent, resolve);
        session = current;
        start(current).catch((error: unknown) => {
          removeFrame();
          current.crash("worker-error", error instanceof Error ? error.message : String(error));
        });
      });
    },

    stop(): void {
      if (session === undefined || session.ended) return;
      removeFrame();
      session.stop();
    },

    dispose(): void {
      removeFrame();
      session?.stop();
      window.removeEventListener("message", listener);
    },
  };
};
