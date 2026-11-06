/// <reference types="node" />
import vm from "node:vm";
import { describe, expect, it } from "vite-plus/test";
import { MAX_CONSOLE_BYTES_PER_TEST, MAX_RESULT_BYTES } from "../shared/limits.ts";
import consoleFlood from "./fixtures/console-flood.js?raw";
import exportDefault from "./fixtures/export-default.ts?raw";
import importLodash from "./fixtures/import-lodash.ts?raw";
import inPlace from "./fixtures/in-place.js?raw";
import returnsSpecial from "./fixtures/returns-special.js?raw";
import throws from "./fixtures/throws.js?raw";
import topLevelThrow from "./fixtures/top-level-throw.js?raw";
import twoSumJs from "./fixtures/two-sum.js?raw";
import twoSumTs from "./fixtures/two-sum.ts?raw";
import guestSource from "./guest.js?raw";
import type { GuestOutput } from "./guest-output.ts";
import { buildLoaderBody, guestConfigFor } from "./invocation.ts";
import { transformSource } from "./transform.ts";
import type { CompareTarget, Language, NodeAdapter, TestKind } from "./types.ts";

// Runs the harness in a fresh Node vm context, which stands in for the sandbox Worker here,
// compiling the user's code the same way the Worker does. The browser suite runs the
// real runner.
const runGuest = (
  source: string,
  functionName: string,
  args: unknown[],
  options: {
    capture?: CompareTarget;
    language?: Language;
    kind?: TestKind;
    expression?: string;
    inputAdapters?: NodeAdapter[];
    outputAdapter?: NodeAdapter;
  } = {},
): GuestOutput => {
  const transformed = transformSource(source, options.language ?? "javascript");
  if (!transformed.ok) throw new Error(transformed.message);
  const language = options.language ?? "javascript";
  const config = guestConfigFor(
    {
      id: "t",
      argsJson: "",
      capture: options.capture ?? { kind: "return" },
      kind: options.kind,
      expression: options.expression,
      inputAdapters: options.inputAdapters,
      outputAdapter: options.outputAdapter,
    },
    language,
  );
  const context = vm.createContext({
    __args: JSON.stringify(args),
    __body: buildLoaderBody(transformed.code, functionName, options.kind === "expression"),
    __config: config,
  });
  vm.runInContext(guestSource, context);
  const output = vm.runInContext(
    '__minjiRun(new Function("exports", "module", "require", __body), __args, __config)',
    context,
  ) as string;
  return JSON.parse(output) as GuestOutput;
};

const valueOf = (output: GuestOutput): unknown =>
  output.kind === "returned" ? output.value : output;

describe("structured test modes", () => {
  it("passes a linked list to a solution and converts the returned list", () => {
    const source =
      "function solve(head) { let node = head; while (node.next) node = node.next; node.next = new ListNode(4); return head; }";
    expect(
      valueOf(
        runGuest(source, "solve", [[1, 2, 3]], {
          inputAdapters: ["linked-list"],
          outputAdapter: "linked-list",
        }),
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("uses a node constructor declared in the solution", () => {
    const source =
      "class ListNode { constructor(val) { this.val = val; } } function solve(head) { return head instanceof ListNode ? head : null; }";
    expect(
      valueOf(
        runGuest(source, "solve", [[1, 2]], {
          inputAdapters: ["linked-list"],
          outputAdapter: "linked-list",
        }),
      ),
    ).toEqual([1, 2]);
  });

  it("uses level-order binary-tree arrays with null gaps", () => {
    const source = "function solve(root) { root.left.right = new TreeNode(7); return root; }";
    expect(
      valueOf(
        runGuest(source, "solve", [[1, 2, 3]], {
          inputAdapters: ["binary-tree"],
          outputAdapter: "binary-tree",
        }),
      ),
    ).toEqual([1, 2, 3, null, 7]);
  });

  it("converts a captured argument after an in-place list change", () => {
    const source = "function solve(head) { head.next = new ListNode(9); }";
    expect(
      valueOf(
        runGuest(source, "solve", [[1, 2]], {
          capture: { kind: "argument", index: 0 },
          inputAdapters: ["linked-list"],
          outputAdapter: "linked-list",
        }),
      ),
    ).toEqual([1, 9]);
  });

  it("runs class constructor and methods in order", () => {
    const source =
      "class Counter { constructor(start) { this.n = start; } add(n) { this.n += n; } get() { return this.n; } }";
    expect(
      valueOf(
        runGuest(
          source,
          "Counter",
          [
            ["Counter", "add", "get", "add", "get"],
            [[2], [3], [], [4], []],
          ],
          { kind: "class" },
        ),
      ),
    ).toEqual([null, null, 5, null, 9]);
  });

  it("reports cyclic node output", () => {
    const source = "function solve(head) { head.next = head; return head; }";
    expect(
      runGuest(source, "solve", [[1]], {
        inputAdapters: ["linked-list"],
        outputAdapter: "linked-list",
      }),
    ).toMatchObject({
      kind: "threw",
      error: { name: "TypeError", message: "Invalid or cyclic linked list" },
    });
  });
});

describe("call expressions", () => {
  const curriedSum = `function sum(first) {
    let total = first;

    function add(next) {
      if (next === undefined) {
        return total;
      }

      total += next;
      return add;
    }

    return add;
  }`;
  const evaluate = (
    source: string,
    expression: string,
    language: "javascript" | "typescript" = "javascript",
  ): GuestOutput => runGuest(source, "solve", [], { kind: "expression", expression, language });

  it("runs chained calls and compares the final value", () => {
    expect(valueOf(evaluate(curriedSum, "sum(1)(2)(3)()"))).toBe(6);
  });

  it("reaches classes, constants and helpers declared in the solution", () => {
    const source =
      "const STEP = 2; const twice = (n) => n * STEP; class Counter { constructor(n) { this.n = n; } add(n) { this.n += n; return this; } get() { return this.n; } }";
    expect(valueOf(evaluate(source, "new Counter(twice(1)).add(STEP).get()"))).toBe(4);
  });

  it("passes values JSON can't express", () => {
    const source = "function count(map, pick) { return pick(map.size); }";
    expect(valueOf(evaluate(source, 'count(new Map([["a", 1]]), (n) => n + 1)'))).toBe(2);
  });

  it("supplies the node constructors", () => {
    const source = "function head(node) { return node.val; }";
    expect(valueOf(evaluate(source, "head(new ListNode(7))"))).toBe(7);
  });

  it("strips TypeScript from the expression", () => {
    const source = "function id<T>(value: T): T { return value; }";
    expect(valueOf(evaluate(source, "id<number>(1 as number)", "typescript"))).toBe(1);
  });

  it("treats braces as an object and allows a trailing comment", () => {
    expect(valueOf(evaluate("", "{ a: 1 } // shape"))).toEqual({ a: 1 });
  });

  it("doesn't need a function with the entry point's name", () => {
    expect(valueOf(evaluate("function other() { return 1; }", "other()"))).toBe(1);
  });

  it("fails only this test on a syntax error", () => {
    expect(evaluate(curriedSum, "sum(1")).toMatchObject({
      kind: "threw",
      error: { name: "SyntaxError" },
    });
    expect(evaluate("function id(v: number) { return v; }", "id(1", "typescript")).toMatchObject({
      kind: "threw",
      error: { name: "SyntaxError" },
    });
  });

  it("reports a thrown error", () => {
    expect(evaluate("function bad() { throw new RangeError('no'); }", "bad()")).toMatchObject({
      kind: "threw",
      error: { name: "RangeError", message: "no" },
    });
  });

  it("reports an expression that stops on a function", () => {
    expect(evaluate(curriedSum, "sum(1)(2)")).toMatchObject({
      kind: "non-serializable",
      type: "Function",
    });
  });

  it("leaves the loader without eval for other test types", () => {
    expect(buildLoaderBody("", "solve")).not.toContain("eval");
  });
});

describe("function lookup", () => {
  it("calls a TypeScript function declaration", () => {
    expect(
      valueOf(runGuest(twoSumTs, "twoSum", [[2, 7, 11, 15], 9], { language: "typescript" })),
    ).toEqual([0, 1]);
  });

  it("calls a var-assigned function expression", () => {
    expect(valueOf(runGuest(twoSumJs, "twoSum", [[3, 2, 4], 6]))).toEqual([1, 2]);
  });

  it("falls back to the default export", () => {
    expect(valueOf(runGuest(exportDefault, "solution", [5], { language: "typescript" }))).toBe(10);
  });

  it("finds module.exports assignments", () => {
    expect(valueOf(runGuest("module.exports = (n) => n + 1;", "solve", [1]))).toBe(2);
  });

  it("reports a missing function", () => {
    expect(runGuest(twoSumJs, "threeSum", []).kind).toBe("missing-function");
  });

  it("reports imports", () => {
    expect(runGuest(importLodash, "solve", [], { language: "typescript" })).toMatchObject({
      kind: "imports-unsupported",
      specifier: "lodash",
    });
  });
});

describe("values", () => {
  const special = (kind: string): unknown => valueOf(runGuest(returnsSpecial, "special", [kind]));

  it("tags values JSON would change", () => {
    expect(special("undefined")).toEqual({ $minji: "undefined" });
    expect(special("nan")).toEqual({ $minji: "NaN" });
    expect(special("negative-zero")).toEqual({ $minji: "-0" });
    expect(special("infinity")).toEqual([{ $minji: "Infinity" }, { $minji: "-Infinity" }]);
    expect(special("holes")).toEqual([1, { $minji: "undefined" }, 3]);
    expect(special("nested-undefined")).toEqual({
      a: { $minji: "undefined" },
      b: [{ $minji: "undefined" }],
    });
  });

  it("wraps objects that already use the tag key", () => {
    expect(special("dollar-key")).toEqual({ $minji: "object", value: { $minji: "NaN" } });
  });

  it("keeps a __proto__ key as data", () => {
    const value = special("proto-key") as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(["__proto__"]);
  });

  it.each([
    ["map", "", "Map"],
    ["nested-set", ".items[1]", "Set"],
    ["cycle", "[1]", "circular reference"],
    ["bigint", "", "BigInt"],
    ["class", "", "Point"],
  ])("reports %s as non-serializable", (kind, path, type) => {
    expect(runGuest(returnsSpecial, "special", [kind])).toMatchObject({
      kind: "non-serializable",
      path,
      type,
    });
  });

  it("captures an argument after the call", () => {
    const output = runGuest(inPlace, "moveZeroes", [[0, 1, 0, 3, 12]], {
      capture: { kind: "argument", index: 0 },
    });
    expect(valueOf(output)).toEqual([1, 3, 12, 0, 0]);
  });

  it("stops encoding past the result limit", () => {
    const source = `function big() { return "x".repeat(${MAX_RESULT_BYTES + 10}); }`;
    expect(runGuest(source, "big", []).kind).toBe("output-too-large");
  });

  it("survives user code that replaces JSON helpers", () => {
    const source =
      'JSON.stringify = () => "broken"; JSON.parse = () => 0; function f(a) { return [a]; }';
    expect(valueOf(runGuest(source, "f", [1]))).toEqual([1]);
  });
});

describe("errors", () => {
  it("reports a thrown error with its console output", () => {
    const output = runGuest(throws, "explode", ["boom"]);
    expect(output).toMatchObject({ kind: "threw", error: { name: "TypeError", message: "boom" } });
    expect(output.console).toEqual([{ level: "error", text: "before throw" }]);
  });

  it("reports errors thrown while loading the code", () => {
    expect(runGuest(topLevelThrow, "solve", [])).toMatchObject({
      kind: "threw",
      phase: "load",
      error: { name: "ReferenceError" },
    });
  });

  it("reports non-Error throws", () => {
    expect(runGuest("function f() { throw { code: 1 }; }", "f", [])).toMatchObject({
      kind: "threw",
      error: { name: "Thrown value", message: "{code: 1}" },
    });
  });
});

describe("console", () => {
  it("formats values like the spec", () => {
    const source =
      'function f() { console.log("x", { a: undefined }, [1, NaN], -0, new Map(), f); }';
    expect(runGuest(source, "f", []).console).toEqual([
      { level: "log", text: "x {a: undefined} [1, NaN] -0 [Map] [Function f]" },
    ]);
  });

  it("truncates a flood of output at the per-test budget", () => {
    const output = runGuest(consoleFlood, "flood", [10_000]);
    const used = output.console.reduce((total, entry) => total + entry.text.length + 1, 0);
    expect(output.consoleTruncated).toBe(true);
    expect(used).toBeLessThanOrEqual(MAX_CONSOLE_BYTES_PER_TEST);
    expect(valueOf(output)).toBe(10_000);
  });
});
