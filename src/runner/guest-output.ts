import type { ConsoleEntry, Encoded, ErrorInfo, RawTestResult } from "./types.ts";

interface GuestCommon {
  console: ConsoleEntry[];
  consoleTruncated: boolean;
  durationMs: number;
}

/** The JSON object `__minjiRun` returns for one test. */
export type GuestOutput = GuestCommon &
  (
    | { kind: "returned"; value: Encoded }
    | { kind: "threw"; error: ErrorInfo; phase?: "load" | "args" }
    | { kind: "imports-unsupported"; specifier: string }
    | { kind: "missing-function" }
    | { kind: "non-serializable"; path: string; type: string }
    | { kind: "output-too-large" }
  );

export type MappedOutput =
  | { type: "result"; result: RawTestResult }
  | { type: "imports-unsupported"; specifier: string };

// V8 and JavaScriptCore say "Maximum call stack size exceeded", SpiderMonkey "too much recursion".
const STACK_OVERFLOW = /call stack size|too much recursion/i;
const OUT_OF_MEMORY = /out of memory|allocation failed/i;

export const classifyError = (error: ErrorInfo): "stack-overflow" | "memory-limit" | "threw" => {
  if (STACK_OVERFLOW.test(error.message)) return "stack-overflow";
  if (OUT_OF_MEMORY.test(error.message)) return "memory-limit";
  return "threw";
};

export const toRawResult = (testId: string, output: GuestOutput): MappedOutput => {
  const base = {
    testId,
    console: output.console,
    consoleTruncated: output.consoleTruncated,
    durationMs: output.durationMs,
  };
  switch (output.kind) {
    case "returned":
      return { type: "result", result: { ...base, kind: "returned", value: output.value } };
    case "threw":
      return {
        type: "result",
        result: { ...base, kind: classifyError(output.error), error: output.error },
      };
    case "imports-unsupported":
      return { type: "imports-unsupported", specifier: output.specifier };
    case "missing-function":
      return { type: "result", result: { ...base, kind: "missing-function" } };
    case "non-serializable":
      return {
        type: "result",
        result: {
          ...base,
          kind: "non-serializable",
          nonSerializable: { path: output.path, type: output.type },
        },
      };
    case "output-too-large":
      return { type: "result", result: { ...base, kind: "output-too-large" } };
    default:
      return output satisfies never;
  }
};

/** A result for a test that produced no guest output (timeout, crash, stop). */
export const emptyResult = (
  testId: string,
  kind: RawTestResult["kind"],
  extra: Partial<RawTestResult> = {},
): RawTestResult => ({
  testId,
  kind,
  console: [],
  consoleTruncated: false,
  durationMs: 0,
  ...extra,
});
