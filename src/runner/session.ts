import {
  MAX_CONSOLE_BYTES_PER_RUN,
  MAX_RUN_TIMEOUT_MS,
  RUN_OVERHEAD_MS,
  WATCHDOG_GRACE_MS,
} from "../shared/limits.ts";
import { emptyResult } from "./guest-output.ts";
import type { ConsoleEntry, RawTestResult, RunRequest, RunnerEvent } from "./types.ts";

/** Time a run may take once the runtime is loaded, before the watchdog kills it. */
export const runBudgetMs = (request: RunRequest): number =>
  Math.min(MAX_RUN_TIMEOUT_MS, request.tests.length * request.testTimeoutMs + RUN_OVERHEAD_MS) +
  WATCHDOG_GRACE_MS;

const trimConsole = (
  entries: ConsoleEntry[],
  remaining: number,
): { entries: ConsoleEntry[]; used: number; truncated: boolean } => {
  const kept: ConsoleEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const cost = entry.text.length + 1;
    if (used + cost > remaining) {
      const room = remaining - used - 1;
      if (room > 0) kept.push({ level: entry.level, text: entry.text.slice(0, room) });
      return { entries: kept, used: remaining, truncated: true };
    }
    kept.push(entry);
    used += cost;
  }
  return { entries: kept, used, truncated: false };
};

/**
 * Page-side bookkeeping for one run, shared by both runners: forwards events, applies the
 * per-run console cap, runs the watchdog, and guarantees the run ends exactly once with
 * `run-complete` or `crashed`.
 */
export class RunSession {
  readonly request: RunRequest;
  private readonly onEvent: (event: RunnerEvent) => void;
  private readonly onEnd: () => void;
  private readonly reported = new Set<string>();
  private consoleRemaining = MAX_CONSOLE_BYTES_PER_RUN;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  constructor(request: RunRequest, onEvent: (event: RunnerEvent) => void, onEnd: () => void) {
    this.request = request;
    this.onEvent = onEvent;
    this.onEnd = onEnd;
  }

  get ended(): boolean {
    return this.finished;
  }

  /** Starts the watchdog. Call once the runtime is loaded, so download time doesn't count. */
  startWatchdog(budgetMs: number, onFire: () => void): void {
    if (this.finished || this.watchdog !== undefined) return;
    this.watchdog = setTimeout(onFire, budgetMs);
  }

  compileError(message: string, line?: number, column?: number): void {
    this.forward({ type: "compile-error", runId: this.request.runId, message, line, column });
    this.complete(false);
  }

  importsUnsupported(specifier: string): void {
    this.forward({ type: "imports-unsupported", runId: this.request.runId, specifier });
    this.complete(false);
  }

  result(result: RawTestResult): void {
    if (this.finished || this.reported.has(result.testId)) return;
    this.reported.add(result.testId);
    const trimmed = trimConsole(result.console, this.consoleRemaining);
    this.consoleRemaining -= trimmed.used;
    this.forward({
      type: "test-result",
      runId: this.request.runId,
      result: {
        ...result,
        console: trimmed.entries,
        consoleTruncated: result.consoleTruncated || trimmed.truncated,
      },
    });
  }

  complete(stopped: boolean): void {
    if (this.finished) return;
    this.forward({ type: "run-complete", runId: this.request.runId, stopped });
    this.end();
  }

  /** Reports every test without a result as stopped, then completes. */
  stop(): void {
    if (this.finished) return;
    for (const test of this.request.tests) {
      if (!this.reported.has(test.id)) this.result(emptyResult(test.id, "stopped"));
    }
    this.complete(true);
  }

  crash(reason: "watchdog" | "worker-error", message: string): void {
    if (this.finished) return;
    this.forward({ type: "crashed", runId: this.request.runId, reason, message });
    this.end();
  }

  private forward(event: RunnerEvent): void {
    if (!this.finished) this.onEvent(event);
  }

  private end(): void {
    this.finished = true;
    clearTimeout(this.watchdog);
    this.onEnd();
  }
}
