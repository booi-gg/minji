// Runner contract shared by the page and both runner implementations. See specs/runner.md.

export type Language = "javascript" | "typescript";

export type CompareTarget = { kind: "return" } | { kind: "argument"; index: number };

/** JSON, plus `{"$minji": ...}` tags for values JSON would silently change. */
export type Encoded = null | boolean | number | string | Encoded[] | { [key: string]: Encoded };

export interface RunnerTest {
  id: string;
  /** JSON array text, already validated by the page. Parsed inside the sandbox. */
  argsJson: string;
  capture: CompareTarget;
}

export interface RunRequest {
  runId: string;
  language: Language;
  source: string;
  functionName: string;
  tests: RunnerTest[];
  testTimeoutMs: number;
}

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  level: ConsoleLevel;
  text: string;
}

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
}

export type RawResultKind =
  | "returned"
  | "threw"
  | "timeout"
  | "non-serializable"
  | "missing-function"
  | "memory-limit"
  | "stack-overflow"
  | "output-too-large"
  | "stopped";

export interface RawTestResult {
  testId: string;
  kind: RawResultKind;
  value?: Encoded;
  error?: ErrorInfo;
  nonSerializable?: { path: string; type: string };
  console: ConsoleEntry[];
  consoleTruncated: boolean;
  /** Time inside the function call only. */
  durationMs: number;
}

export type RunnerEvent =
  | { type: "compile-error"; runId: string; message: string; line?: number; column?: number }
  | { type: "imports-unsupported"; runId: string; specifier: string }
  | { type: "test-result"; runId: string; result: RawTestResult }
  | { type: "run-complete"; runId: string; stopped: boolean }
  | { type: "crashed"; runId: string; reason: "watchdog" | "worker-error"; message: string };

export interface Runner {
  /** Resolves once the run has ended, whichever way it ended. */
  run(request: RunRequest, onEvent: (event: RunnerEvent) => void): Promise<void>;
  /** Kills the current run; tests without a result are reported as stopped. */
  stop(): void;
  dispose(): void;
}
