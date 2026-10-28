import { describe, expect, it } from "vite-plus/test";
import arrowStarter from "./fixtures/arrow-starter.md?raw";
import badOutput from "./fixtures/bad-output.txt?raw";
import gridWords from "./fixtures/grid-words.md?raw";
import isPower from "./fixtures/is-power.txt?raw";
import multilineInput from "./fixtures/multiline-input.txt?raw";
import noStarter from "./fixtures/no-starter.txt?raw";
import pairSumStarter from "./fixtures/pair-sum.starter.ts?raw";
import pairSum from "./fixtures/pair-sum.txt?raw";
import reverseWords from "./fixtures/reverse-words.md?raw";
import shiftZerosStarter from "./fixtures/shift-zeros.starter.js?raw";
import shiftZeros from "./fixtures/shift-zeros.txt?raw";
import singleQuotes from "./fixtures/single-quotes.txt?raw";
import unknownArgumentStarter from "./fixtures/unknown-argument.starter.ts?raw";
import unknownArgument from "./fixtures/unknown-argument.txt?raw";
import {
  argsTextFor,
  findFunction,
  parseProblem,
  splitTopLevel,
  type ImportDraft,
} from "./parseProblem.ts";

const text = (source: string, starter?: string): ImportDraft =>
  parseProblem({ text: source, starter, format: "text", fallbackLanguage: "typescript" });
const markdown = (source: string): ImportDraft =>
  parseProblem({ text: source, format: "markdown", fallbackLanguage: "typescript" });

const testRows = (draft: ImportDraft) =>
  draft.tests.map((test) => [argsTextFor(test, draft.params), test.expectedText]);

describe("pasted text", () => {
  it("imports class-design examples as method sequences", () => {
    const draft = text(
      'Min Stack\nExample 1:\nInput:\n["MinStack","push","getMin"]\n[[],[3],[]]\nOutput: [null,null,3]',
      "class MinStack { push(value) { this.value = value; } getMin() { return this.value; } }",
    );
    expect(draft.functionName).toBe("MinStack");
    expect(draft.params).toEqual([]);
    expect(draft.tests[0]?.kind).toBe("class");
    expect(testRows(draft)).toEqual([
      ['[["MinStack","push","getMin"],[[],[3],[]]]', "[null,null,3]"],
    ]);
  });
  it("keeps a function target when starter code also declares a node class", () => {
    const draft = text(
      "Reverse List\nExample 1:\nInput: head = [1,2]\nOutput: [2,1]",
      "class ListNode {}\nfunction reverseList(head) { return head; }",
    );
    expect(draft.functionName).toBe("reverseList");
    expect(draft.params).toEqual(["head"]);
    expect(draft.tests[0]?.kind).toBeUndefined();
  });
  it("reads a LeetCode-style statement with separate starter code", () => {
    const draft = text(pairSum, pairSumStarter);
    expect(draft).toMatchObject({
      title: "Pair With Target Sum",
      language: "typescript",
      functionName: "pairWithSum",
      params: ["nums", "target"],
      paramsConfirmed: true,
      starterSource: pairSumStarter,
      suggestInPlace: false,
      warnings: [],
    });
    expect(testRows(draft)).toEqual([
      ["[[3,8,1,6], 9]", "[1,2]"],
      ["[[5,5], 10]", "[0,1]"],
    ]);
    expect(draft.statement.startsWith("Easy\nGiven a list of integers")).toBe(true);
    expect(draft.statement).toContain("Constraints:");
    expect(draft.statement).not.toContain("Pair With Target Sum");
  });

  it("suggests comparing the argument for in-place problems", () => {
    const draft = text(shiftZeros, shiftZerosStarter);
    expect(draft).toMatchObject({
      language: "javascript",
      functionName: "shiftZeros",
      params: ["nums"],
      suggestInPlace: true,
    });
    expect(testRows(draft)).toEqual([
      ["[[0,4,0,2,9]]", "[4,2,9,0,0]"],
      ["[[7]]", "[7]"],
    ]);
  });

  it("treats a bare input as the only argument", () => {
    const draft = text(isPower);
    expect(draft).toMatchObject({ functionName: "solve", params: [], paramsConfirmed: false });
    expect(testRows(draft)).toEqual([
      ["[27]", "true"],
      ["[10]", "false"],
    ]);
    expect(draft.starterSource).toBe("function solve() {\n  \n}\n");
  });

  it("guesses parameters from the first example when there is no starter", () => {
    const draft = text(noStarter);
    expect(draft).toMatchObject({ params: ["values", "minLength"], paramsConfirmed: false });
    expect(draft.starterSource).toBe("function solve(values, minLength) {\n  \n}\n");
    expect(testRows(draft)[0]).toEqual(["[[1,1,2,2,2,3], 2]", "3"]);
  });

  it("converts single-quoted strings", () => {
    expect(testRows(text(singleQuotes))).toEqual([['["banana", "ae"]', "3"]]);
  });

  it("joins inputs that span several lines", () => {
    expect(testRows(text(multilineInput))).toEqual([["[[[1,2,3],[4,5,6],[7,8,9]]]", "15"]]);
  });

  it("warns about arguments that aren't parameters", () => {
    const draft = text(unknownArgument, unknownArgumentStarter);
    expect(draft.warnings).toEqual(['Example 2 has an argument "steps" that isn\'t a parameter.']);
    expect(testRows(draft)[1]).toEqual(["[[1,2], null, 3]", "[2,1]"]);
  });

  it("keeps unreadable values as raw text with a warning", () => {
    const draft = text(badOutput);
    expect(draft.tests[0]).toMatchObject({ expectedText: "[1,2,", expectedValid: false });
    expect(draft.warnings).toContain(
      "Example 1 has an output that isn't valid JSON; fix it below.",
    );
  });

  it("warns when there are no examples", () => {
    expect(text("Just a statement.").warnings).toEqual([
      "No examples were found, so there are no tests yet.",
    ]);
  });
});

describe("Markdown", () => {
  it("takes the heading as title and a fenced block as starter", () => {
    const draft = markdown(reverseWords);
    expect(draft).toMatchObject({
      title: "Reverse the Words",
      language: "typescript",
      functionName: "reverseWords",
      params: ["s"],
      starterSource: "function reverseWords(s: string): string {\n}\n",
    });
    expect(draft.statement).not.toContain("function reverseWords");
    expect(draft.statement).toContain("**Example 1:**");
    expect(testRows(draft)).toEqual([
      ['["the sky, blue"]', '"blue sky, the"'],
      ['["  hello   world "]', '"world hello"'],
    ]);
  });

  it("handles bold labels and commas and brackets inside strings", () => {
    const draft = markdown(gridWords);
    expect(draft).toMatchObject({ title: "Find Word in Grid", params: ["grid", "word"] });
    expect(testRows(draft)).toEqual([
      ['[[["a","b"],["c,d","e]"]], "ab,c"]', "true"],
      ['[[["x"]], "y"]', "false"],
    ]);
  });

  it("reads arrow-function starters with defaults", () => {
    const draft = markdown(arrowStarter);
    expect(draft).toMatchObject({
      language: "javascript",
      functionName: "countIslands",
      params: ["grid", "diagonal"],
    });
    expect(testRows(draft)).toEqual([["[[[1,0],[0,1]], true]", "1"]]);
  });
});

describe("helpers", () => {
  it("splits on top-level commas only", () => {
    expect(splitTopLevel('a = [1,2], b = "x,y", c = {"k": [3,4]}')).toEqual([
      "a = [1,2]",
      ' b = "x,y"',
      ' c = {"k": [3,4]}',
    ]);
  });

  it("finds TypeScript parameters with generic types", () => {
    expect(findFunction("function f(map: Map<string, number>, list?: number[]) {}")).toEqual({
      name: "f",
      params: ["map", "list"],
    });
  });
});
