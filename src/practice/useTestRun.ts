// Runs tests through the sandboxed runner and keeps the live results for the Test Result
// tab. See specs/test-cases.md and specs/runner.md.
import { useCallback, useEffect, useRef, useState } from "react";
import { getDatabase } from "../db/database.ts";
import { addRun, setLastRun } from "../db/workspaces.ts";
import type { Runner, RunnerEvent } from "../runner/types.ts";
import { postChannelMessage } from "../shared/channel.ts";
import { newId } from "../shared/ids.ts";
import {
  compileErrorMessage,
  crashedResult,
  importsMessage,
  prepareRun,
  toTestResult,
  type RunOutcome,
  type RunScope,
  type TestResult,
} from "../tests/results.ts";
import type { TestCase, Workspace } from "../workspaces/model.ts";

export interface RunMessage {
  text: string;
  line?: number;
  column?: number;
}

export interface RunView {
  scope: RunScope["kind"];
  running: boolean;
  outcome: RunOutcome | null;
  message: RunMessage | null;
  /** Selected tests in display order; ids without a result are still running. */
  order: { id: string; label: string; argsText: string }[];
  results: Map<string, TestResult>;
}

interface UseTestRunOptions {
  /** Latest workspace and tests at the moment a run starts. */
  getState: () => { workspace: Workspace; tests: TestCase[] };
  /** Flushes edits and saves a `run` revision; resolves with its id. */
  beforeRun: () => Promise<string | null>;
  onLastRun: (lastRun: NonNullable<Workspace["lastRun"]>) => void;
}

let runnerModule: Promise<typeof import("../runner/createRunner.ts")> | undefined;

/** The runner code loads on the first run, not with the page. */
const loadRunner = async (): Promise<Runner> => {
  runnerModule ??= import("../runner/createRunner.ts");
  const { createRunner } = await runnerModule;
  return createRunner();
};

const labelOf = (test: TestCase): string =>
  test.label.trim() === "" ? `Test ${test.position + 1}` : test.label;

export const useTestRun = ({ getState, beforeRun, onLastRun }: UseTestRunOptions) => {
  const [view, setView] = useState<RunView | null>(null);
  const runner = useRef<Runner | null>(null);
  const active = useRef(false);
  const options = useRef({ getState, beforeRun, onLastRun });
  options.current = { getState, beforeRun, onLastRun };

  useEffect(
    () => () => {
      runner.current?.dispose();
      runner.current = null;
    },
    [],
  );

  const run = useCallback(async (scope: RunScope): Promise<void> => {
    if (active.current) return;
    active.current = true;
    const startedAt = new Date();
    const started = performance.now();
    const { workspace, tests } = options.current.getState();
    const runId = newId();
    const prepared = prepareRun(workspace, tests, scope, runId);
    const order =
      prepared.kind === "ready"
        ? prepared.selected.map((test) => ({
            id: test.id,
            label: labelOf(test),
            argsText: test.argsText,
          }))
        : [];
    const results = new Map<string, TestResult>(
      prepared.kind === "ready" ? prepared.invalid.map((result) => [result.testId, result]) : [],
    );
    // Mutable run state, updated from runner callbacks.
    const state: { outcome: RunOutcome | null; message: RunMessage | null } = {
      outcome: null,
      message: null,
    };

    const publish = (running: boolean): void => {
      setView({
        scope: scope.kind,
        running,
        outcome: state.outcome,
        message: state.message,
        order,
        results: new Map(results),
      });
    };

    try {
      if (prepared.kind === "rejected") {
        state.outcome = "rejected";
        state.message = { text: prepared.message };
        return;
      }
      publish(true);
      const revisionId = await options.current.beforeRun();
      const testsById = new Map(prepared.selected.map((test) => [test.id, test]));

      if (prepared.request.tests.length > 0) {
        runner.current ??= await loadRunner();
        await runner.current.run(prepared.request, (event: RunnerEvent) => {
          switch (event.type) {
            case "test-result": {
              const test = testsById.get(event.result.testId);
              const expected = prepared.expected.get(event.result.testId);
              if (test === undefined || expected === undefined) return;
              results.set(test.id, toTestResult(event.result, test, expected));
              break;
            }
            case "compile-error":
              state.outcome = "compile-error";
              state.message = {
                text: compileErrorMessage(event.message, event.line, event.column),
                line: event.line,
                column: event.column,
              };
              break;
            case "imports-unsupported":
              state.outcome = "imports-unsupported";
              state.message = { text: importsMessage(event.specifier) };
              break;
            case "run-complete":
              state.outcome ??= event.stopped ? "stopped" : "completed";
              break;
            case "crashed":
              state.outcome = "crashed";
              state.message = { text: "The runner stopped responding and was restarted." };
              for (const test of prepared.selected) {
                if (!results.has(test.id)) results.set(test.id, crashedResult(test));
              }
              break;
            default:
              event satisfies never;
          }
          publish(true);
        });
      } else {
        state.outcome = "completed";
      }

      const finalResults =
        state.outcome === "compile-error" || state.outcome === "imports-unsupported"
          ? []
          : order.flatMap(({ id }) => results.get(id) ?? []);
      const db = await getDatabase();
      await addRun(db, {
        id: runId,
        workspaceId: workspace.id,
        scope: scope.kind,
        startedAt: startedAt.toISOString(),
        durationMs: Math.round(performance.now() - started),
        revisionId,
        outcome: state.outcome ?? "completed",
        message: state.message?.text ?? null,
        results: finalResults,
      });
      if (scope.kind === "all" && state.outcome === "completed") {
        const lastRun = {
          passed: finalResults.filter((result) => result.status === "passed").length,
          total: finalResults.length,
          at: new Date().toISOString(),
        };
        await setLastRun(db, workspace.id, lastRun);
        postChannelMessage({ type: "changed", id: workspace.id });
        options.current.onLastRun(lastRun);
      }
    } finally {
      active.current = false;
      publish(false);
    }
  }, []);

  const stop = useCallback(() => runner.current?.stop(), []);

  return { view, run, stop, running: view?.running ?? false };
};
