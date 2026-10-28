import { isValidIdentifier } from "../shared/ids.ts";
import { MAX_CONSOLE_BYTES_PER_TEST, MAX_RESULT_BYTES } from "../shared/limits.ts";
import type { RunnerTest } from "./types.ts";

export interface GuestConfig {
  /** -1 captures the return value; otherwise the argument at this index after the call. */
  captureIndex: number;
  consoleBudget: number;
  maxResultSize: number;
  kind: "function" | "class";
  inputAdapters: ("plain" | "linked-list" | "binary-tree")[];
  outputAdapter: "plain" | "linked-list" | "binary-tree";
}

export const guestConfigFor = (test: RunnerTest): GuestConfig => ({
  captureIndex: test.capture.kind === "argument" ? test.capture.index : -1,
  consoleBudget: MAX_CONSOLE_BYTES_PER_TEST,
  maxResultSize: MAX_RESULT_BYTES,
  kind: test.kind ?? "function",
  inputAdapters: test.inputAdapters ?? [],
  outputAdapter: test.outputAdapter ?? "plain",
});

const lookupExpression = (name: string): string =>
  [
    `typeof ${name} === "function" ? ${name}`,
    `typeof exports.${name} === "function" ? exports.${name}`,
    `typeof module.exports === "function" ? module.exports`,
    "exports.default",
  ].join(" : ");

/**
 * Body of the loader function: transformed user code followed by the callable and
 * any node constructors declared by that code.
 */
export const buildLoaderBody = (code: string, functionName: string): string => {
  if (!isValidIdentifier(functionName)) {
    throw new Error(`Invalid function name: ${JSON.stringify(functionName)}`);
  }
  return `${code}\n;return { callable: (${lookupExpression(functionName)}), listNode: typeof ListNode === "function" ? ListNode : undefined, treeNode: typeof TreeNode === "function" ? TreeNode : undefined };`;
};
