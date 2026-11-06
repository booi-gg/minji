import { expect, it } from "vite-plus/test";
import { entryPointFromSource } from "./entryPoint.ts";

it("infers a single function and its parameters", () => {
  expect(entryPointFromSource("function bubbleSort(values: number[]) {}", "solve")).toEqual({
    name: "bubbleSort",
    params: ["values"],
  });
});

it("keeps the known entry point when there are helpers", () => {
  const source = "function helper() {}\nfunction twoSum(nums, target) {}";
  expect(entryPointFromSource(source, "twoSum")).toEqual({
    name: "twoSum",
    params: ["nums", "target"],
  });
  expect(entryPointFromSource(source, "solve")).toBeUndefined();
});

it("ignores functions nested inside the entry point", () => {
  const source = `function sum(first) {
  let total = first;

  function add(next) {
    return add;
  }

  const unused = (value) => value;
  return add;
}`;
  expect(entryPointFromSource(source, "solve")).toEqual({ name: "sum", params: ["first"] });
});

it("finds the common LeetCode function expression and classes", () => {
  expect(entryPointFromSource("var addTwoNumbers = function(l1, l2) {};", "solve")).toEqual({
    name: "addTwoNumbers",
    params: ["l1", "l2"],
  });
  expect(entryPointFromSource("class MinStack { constructor() {} }", "solve")).toEqual({
    name: "MinStack",
    params: [],
  });
});
