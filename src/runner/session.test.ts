import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  MAX_CONSOLE_BYTES_PER_RUN,
  MAX_RUN_TIMEOUT_MS,
  WATCHDOG_GRACE_MS,
} from "../shared/limits.ts";
import { emptyResult } from "./guest-output.ts";
import { RunSession, runBudgetMs } from "./session.ts";
import type { RunRequest, RunnerEvent } from "./types.ts";

const request = (testCount: number): RunRequest => ({
  runId: "run-1",
  language: "javascript",
  source: "",
  functionName: "f",
  testTimeoutMs: 2000,
  tests: Array.from({ length: testCount }, (_, index) => ({
    id: `t${index}`,
    argsJson: "[]",
    capture: { kind: "return" as const },
  })),
});

const setup = (testCount: number) => {
  const events: RunnerEvent[] = [];
  const onEnd = vi.fn();
  const session = new RunSession(request(testCount), (event) => events.push(event), onEnd);
  return { events, onEnd, session };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("caps the run budget", () => {
  expect(runBudgetMs(request(2))).toBe(2 * 2000 + 5000 + WATCHDOG_GRACE_MS);
  expect(runBudgetMs(request(100))).toBe(MAX_RUN_TIMEOUT_MS + WATCHDOG_GRACE_MS);
});

it("fires the watchdog once the budget passes", () => {
  const { events, onEnd, session } = setup(1);
  session.startWatchdog(1000, () => session.crash("watchdog", "hung"));
  vi.advanceTimersByTime(999);
  expect(onEnd).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(events).toEqual([
    { type: "crashed", runId: "run-1", reason: "watchdog", message: "hung" },
  ]);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

it("clears the watchdog when the run completes", () => {
  const { events, session } = setup(1);
  const onFire = vi.fn();
  session.startWatchdog(1000, onFire);
  session.complete(false);
  vi.advanceTimersByTime(5000);
  expect(onFire).not.toHaveBeenCalled();
  expect(events).toHaveLength(1);
});

it("reports tests without a result as stopped", () => {
  const { events, session } = setup(3);
  session.result(emptyResult("t0", "returned", { value: 1 }));
  session.stop();
  expect(
    events.map((event) => (event.type === "test-result" ? event.result.kind : event.type)),
  ).toEqual(["returned", "stopped", "stopped", "run-complete"]);
});

it("ignores events after the run ended and duplicate results", () => {
  const { events, onEnd, session } = setup(2);
  session.result(emptyResult("t0", "returned"));
  session.result(emptyResult("t0", "threw"));
  session.complete(false);
  session.result(emptyResult("t1", "returned"));
  session.crash("worker-error", "late");
  expect(events).toHaveLength(2);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

it("applies the per-run console cap across tests", () => {
  const { events, session } = setup(6);
  const text = "x".repeat(16_000);
  for (let index = 0; index < 6; index += 1) {
    session.result(emptyResult(`t${index}`, "returned", { console: [{ level: "log", text }] }));
  }
  const results = events.flatMap((event) => (event.type === "test-result" ? [event.result] : []));
  const used = results
    .flatMap((result) => result.console)
    .reduce((total, entry) => total + entry.text.length + 1, 0);
  expect(used).toBeLessThanOrEqual(MAX_CONSOLE_BYTES_PER_RUN);
  expect(results.at(-1)?.consoleTruncated).toBe(true);
  expect(results[0]?.consoleTruncated).toBe(false);
});
