import { expect, it } from "vite-plus/test";
import type { CompareTarget } from "../runner/types.ts";
import { validateTest } from "./validate.ts";

const test = (
  argsText: string,
  expectedText: string,
  compare: CompareTarget = { kind: "return" },
) => ({
  argsText,
  expectedText,
  compare,
});

it("accepts a valid case", () => {
  expect(validateTest(test("[[2,7,11,15], 9]", "[0,1]"), ["nums", "target"])).toEqual({
    valid: true,
    argCount: 2,
  });
});

it("reports arguments that aren't JSON or aren't an array", () => {
  expect(validateTest(test("[1,", "1")).args).toMatch(/^Arguments aren't valid JSON: /);
  expect(validateTest(test("{}", "1")).args).toBe(
    "Arguments must be a JSON array, one entry per parameter, e.g. [[2,7,11,15], 9]",
  );
});

it("reports empty, invalid or unknown-tag expected values", () => {
  expect(validateTest(test("[]", "  ")).expected).toBe(
    "Expected value isn't valid JSON: it's empty.",
  );
  expect(validateTest(test("[]", "[1,")).expected).toMatch(/^Expected value isn't valid JSON: /);
  expect(validateTest(test("[]", '[{"$minji":"nan"}]')).expected).toBe(
    'Unknown special value "nan". Use undefined, NaN, Infinity, -Infinity or -0.',
  );
  expect(validateTest(test("[]", '{"$minji":"NaN"}')).valid).toBe(true);
});

it("reports a compare target past the last argument", () => {
  expect(validateTest(test("[[1]]", "[1]", { kind: "argument", index: 1 })).compare).toBe(
    "There is no argument 2 to compare.",
  );
});

it("warns, without blocking, when the argument count differs from the params", () => {
  const result = validateTest(test("[1, 2, 3]", "0"), ["nums", "target"]);
  expect(result.warning).toBe("Expected 2 arguments (nums, target), found 3.");
  expect(result.valid).toBe(true);
});
