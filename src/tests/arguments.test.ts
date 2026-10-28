import { expect, it } from "vite-plus/test";
import { joinArguments, splitArguments } from "./arguments.ts";

it("splits nested values and quoted commas into named argument fragments", () => {
  expect(splitArguments('[[2,4,3], {"text":"a,b"}]')).toEqual(["[2,4,3]", '{"text":"a,b"}']);
  expect(joinArguments(["[2,4,3]", "[5,6,4]"])).toBe("[[2,4,3], [5,6,4]]");
});

it("keeps an empty draft visible and falls back when the outer array is incomplete", () => {
  expect(splitArguments("[1, ]")).toEqual(["1", ""]);
  expect(splitArguments("[1, [2]")).toBeNull();
  expect(splitArguments("not an array")).toBeNull();
});
