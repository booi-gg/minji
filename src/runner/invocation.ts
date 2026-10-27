import { isValidIdentifier } from "../shared/ids.ts";
import { MAX_CONSOLE_BYTES_PER_TEST, MAX_RESULT_BYTES } from "../shared/limits.ts";
import type { RunnerTest } from "./types.ts";

export interface GuestConfig {
  /** -1 captures the return value; otherwise the argument at this index after the call. */
  captureIndex: number;
  consoleBudget: number;
  maxResultSize: number;
}

export const guestConfigFor = (test: RunnerTest): GuestConfig => ({
  captureIndex: test.capture.kind === "argument" ? test.capture.index : -1,
  consoleBudget: MAX_CONSOLE_BYTES_PER_TEST,
  maxResultSize: MAX_RESULT_BYTES,
});

const lookupExpression = (name: string): string =>
  [
    `typeof ${name} === "function" ? ${name}`,
    `typeof exports.${name} === "function" ? exports.${name}`,
    `typeof module.exports === "function" ? module.exports`,
    "exports.default",
  ].join(" : ");

/**
 * Body of the loader function `(exports, module, require) => fn`: the transformed user code
 * followed by a lookup of the function to call.
 */
export const buildLoaderBody = (code: string, functionName: string): string => {
  if (!isValidIdentifier(functionName)) {
    throw new Error(`Invalid function name: ${JSON.stringify(functionName)}`);
  }
  return `${code}\n;return (${lookupExpression(functionName)});`;
};
