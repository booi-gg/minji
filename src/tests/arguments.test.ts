import { expect, it } from "vite-plus/test";
import { argsTextForKind, joinArguments, splitArguments } from "./arguments.ts";

it("splits nested values and quoted commas into named argument fragments", () => {
  expect(splitArguments('[[2,4,3], {"text":"a,b"}]')).toEqual(["[2,4,3]", '{"text":"a,b"}']);
  expect(joinArguments(["[2,4,3]", "[5,6,4]"])).toBe("[[2,4,3], [5,6,4]]");
});

it("keeps an empty draft visible and falls back when the outer array is incomplete", () => {
  expect(splitArguments("[1, ]")).toEqual(["1", ""]);
  expect(splitArguments("[1, [2]")).toBeNull();
  expect(splitArguments("not an array")).toBeNull();
});

it("writes a function case's arguments as a call", () => {
  const convert = (argsText: string): string => argsTextForKind({ argsText }, "expression", "sum");
  expect(convert("[1, [2,3]]")).toBe("sum(1, [2,3])");
  expect(convert("[]")).toBe("sum()");
});

it("keeps typed text when moving between function and expression cases", () => {
  const typed = { argsText: "sum(1)(2)()", kind: "expression" as const };
  const asFunction = argsTextForKind(typed, "function", "sum");
  expect(asFunction).toBe("sum(1)(2)()");
  expect(argsTextForKind({ argsText: asFunction }, "expression", "sum")).toBe("sum(1)(2)()");
});

it("starts class and expression conversions from an empty call", () => {
  const sequence = '[["Counter","get"],[[],[]]]';
  expect(argsTextForKind({ argsText: sequence, kind: "class" }, "expression", "Counter")).toBe(
    "new Counter()",
  );
  expect(argsTextForKind({ argsText: "[]" }, "class", "Counter")).toBe('[["Counter"],[[]]]');
});
