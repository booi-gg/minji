import { isValidIdentifier } from "../shared/ids.ts";
import { MAX_CONSOLE_BYTES_PER_TEST, MAX_RESULT_BYTES } from "../shared/limits.ts";
import { EVALUATE_FRAME } from "./stack.ts";
import { transformExpression } from "./transform.ts";
import type { Language, RunnerTest, TestKind } from "./types.ts";

export interface GuestConfig {
  /** -1 captures the return value; otherwise the argument at this index after the call. */
  captureIndex: number;
  consoleBudget: number;
  maxResultSize: number;
  kind: TestKind;
  /** Ready for `eval`, for `expression` tests. */
  expression?: string;
  inputAdapters: ("plain" | "linked-list" | "binary-tree")[];
  outputAdapter: "plain" | "linked-list" | "binary-tree";
}

export const guestConfigFor = (
  test: RunnerTest,
  language: Language = "javascript",
): GuestConfig => ({
  captureIndex: test.capture.kind === "argument" ? test.capture.index : -1,
  consoleBudget: MAX_CONSOLE_BYTES_PER_TEST,
  maxResultSize: MAX_RESULT_BYTES,
  kind: test.kind ?? "function",
  expression:
    test.expression === undefined ? undefined : transformExpression(test.expression, language),
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

// Direct eval reaches the solution's scope without pasting test text into its code. It can
// stop engines optimizing that scope, so only runs with expression tests include it.
const EVALUATE = `, evaluate: function ${EVALUATE_FRAME}() { return eval(arguments[0]); }`;

/**
 * Body of the loader function: transformed user code followed by the callable, any node
 * constructors declared by that code, and an evaluator when the run needs one.
 */
export const buildLoaderBody = (
  code: string,
  functionName: string,
  withEvaluate = false,
): string => {
  if (!isValidIdentifier(functionName)) {
    throw new Error(`Invalid function name: ${JSON.stringify(functionName)}`);
  }
  return `${code}\n;return { callable: (${lookupExpression(functionName)}), listNode: typeof ListNode === "function" ? ListNode : undefined, treeNode: typeof TreeNode === "function" ? TreeNode : undefined${withEvaluate ? EVALUATE : ""} };`;
};
