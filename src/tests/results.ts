// Turning tests into a runner request, and runner output into results and summaries.
// See specs/test-cases.md, "Statuses" and "Run summary".
import type {
  ConsoleEntry,
  Encoded,
  ErrorInfo,
  RawTestResult,
  RunRequest,
} from "../runner/types.ts";
import { isValidIdentifier } from "../shared/ids.ts";
import { MAX_RUN_INPUT_BYTES, MAX_SOURCE_BYTES } from "../shared/limits.ts";
import type { TestCase, Workspace } from "../workspaces/model.ts";
import { compare } from "./compare.ts";
import { validateTest } from "./validate.ts";

export type TestStatus =
  | "passed"
  | "failed"
  | "error"
  | "timeout"
  | "non-serializable"
  | "missing-function"
  | "stack-overflow"
  | "memory-limit"
  | "output-too-large"
  | "invalid-test"
  | "stopped"
  | "crashed";

export type RunOutcome =
  | "completed"
  | "compile-error"
  | "imports-unsupported"
  | "rejected"
  | "stopped"
  | "crashed";

export interface TestResult {
  testId: string;
  /** Snapshot at run time: the label, or "Test n". */
  label: string;
  status: TestStatus;
  expected?: Encoded;
  actual?: Encoded;
  diffPath?: string;
  error?: ErrorInfo;
  nonSerializable?: { path: string; type: string };
  console: ConsoleEntry[];
  consoleTruncated: boolean;
  durationMs: number | null;
}

export type RunScope = { kind: "all" } | { kind: "single"; testId: string };

export type PreparedRun =
  | { kind: "rejected"; message: string }
  | {
      kind: "ready";
      request: RunRequest;
      /** Every selected test in display order, valid or not. */
      selected: TestCase[];
      expected: Map<string, Encoded>;
      /** Results for tests that can't run, reported without running them. */
      invalid: TestResult[];
    };

export const testName = (test: Pick<TestCase, "label" | "position">): string =>
  test.label.trim() === "" ? `Test ${test.position + 1}` : test.label;

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const KB = 1000;

export const prepareRun = (
  workspace: Workspace,
  tests: TestCase[],
  scope: RunScope,
  runId: string,
): PreparedRun => {
  if (byteLength(workspace.source) > MAX_SOURCE_BYTES) {
    return {
      kind: "rejected",
      message: `Your code is larger than the ${MAX_SOURCE_BYTES / KB} KB limit.`,
    };
  }
  if (!isValidIdentifier(workspace.functionName)) {
    return { kind: "rejected", message: "Set a valid function name in the toolbar first." };
  }
  const selected = scope.kind === "all" ? tests : tests.filter((test) => test.id === scope.testId);
  if (selected.length === 0) return { kind: "rejected", message: "Add a test to run." };

  const expected = new Map<string, Encoded>();
  const invalid: TestResult[] = [];
  const runnable: RunRequest["tests"] = [];
  let inputBytes = 0;
  for (const test of selected) {
    const validation = validateTest(test, workspace.params);
    if (!validation.valid) {
      const message =
        validation.args ?? validation.expected ?? validation.compare ?? "Invalid test";
      invalid.push({
        testId: test.id,
        label: testName(test),
        status: "invalid-test",
        error: { name: "Invalid test", message },
        console: [],
        consoleTruncated: false,
        durationMs: null,
      });
      continue;
    }
    inputBytes += byteLength(test.argsText);
    expected.set(test.id, JSON.parse(test.expectedText) as Encoded);
    runnable.push({ id: test.id, argsJson: test.argsText, capture: test.compare });
  }
  if (inputBytes > MAX_RUN_INPUT_BYTES) {
    return {
      kind: "rejected",
      message: "The selected tests' inputs add up to more than the 32 MB limit.",
    };
  }

  return {
    kind: "ready",
    request: {
      runId,
      language: workspace.language,
      source: workspace.source,
      functionName: workspace.functionName,
      tests: runnable,
      testTimeoutMs: workspace.testTimeoutMs,
    },
    selected,
    expected,
    invalid,
  };
};

/** Maps one runner result: a returned value is compared, `threw` becomes `error`. */
export const toTestResult = (raw: RawTestResult, test: TestCase, expected: Encoded): TestResult => {
  const base = {
    testId: raw.testId,
    label: testName(test),
    console: raw.console,
    consoleTruncated: raw.consoleTruncated,
    durationMs: raw.durationMs,
  };
  switch (raw.kind) {
    case "returned": {
      const actual = raw.value ?? null;
      const comparison = compare(expected, actual);
      return comparison.equal
        ? { ...base, status: "passed", expected, actual }
        : { ...base, status: "failed", expected, actual, diffPath: comparison.path };
    }
    case "threw":
      return { ...base, status: "error", error: raw.error };
    case "non-serializable":
      return { ...base, status: "non-serializable", nonSerializable: raw.nonSerializable };
    case "timeout":
    case "stopped":
      return {
        ...base,
        status: raw.kind,
        durationMs: raw.kind === "timeout" ? raw.durationMs : null,
      };
    default:
      return { ...base, status: raw.kind, error: raw.error };
  }
};

/** A test the runner never reported, because the run crashed. */
export const crashedResult = (test: TestCase): TestResult => ({
  testId: test.id,
  label: testName(test),
  status: "crashed",
  console: [],
  consoleTruncated: false,
  durationMs: null,
});

export interface RunLevelMessage {
  outcome: Exclude<RunOutcome, "completed" | "stopped" | "crashed">;
  message: string;
  line?: number;
  column?: number;
}

export const compileErrorMessage = (message: string, line?: number, column?: number): string => {
  if (line === undefined) return `Didn't run: syntax error: ${message}`;
  const where = column === undefined ? `line ${line}` : `line ${line}, column ${column}`;
  return `Didn't run: syntax error on ${where}: ${message}`;
};

export const importsMessage = (specifier: string): string =>
  `Didn't run: imports aren't supported ("${specifier}"). Paste helper code into the solution instead.`;

const plural = (count: number, word: string): string =>
  count === 1 ? `1 ${word}` : `${count} ${word}s`;

const SINGLE_STATUS_TEXT: Partial<Record<TestStatus, string>> = {
  passed: "passed",
  failed: "failed",
  timeout: "timed out",
  error: "threw an error",
  stopped: "was stopped",
};

/** The Results tab's headline. Never says "Accepted". */
export const summarize = (scope: RunScope["kind"], results: TestResult[]): string => {
  if (scope === "single") {
    const [result] = results;
    if (result === undefined) return "";
    const outcome = SINGLE_STATUS_TEXT[result.status] ?? "didn't pass";
    return `Test "${result.label}" ${outcome}`;
  }
  const total = results.length;
  const passed = results.filter((result) => result.status === "passed").length;
  const invalid = results.filter((result) => result.status === "invalid-test").length;
  const allPassed = total === 1 ? "Passed 1 test" : `Passed all ${total} tests`;
  const headline = passed === total ? allPassed : `Passed ${passed} of ${plural(total, "test")}`;
  return invalid === 0 ? headline : `${headline} · ${plural(invalid, "invalid test")} skipped`;
};
