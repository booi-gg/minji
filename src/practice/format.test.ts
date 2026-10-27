import { expect, it } from "vite-plus/test";
import { formatCode } from "./format.ts";

it("formats JavaScript in Prettier style", async () => {
  expect(await formatCode("function f(a,b){return a+b}", "javascript")).toEqual({
    ok: true,
    code: "function f(a, b) {\n  return a + b;\n}\n",
  });
});

it("formats TypeScript with type annotations", async () => {
  expect(
    await formatCode(
      "const twoSum=(nums:number[],target:number):number[]=>{return []}",
      "typescript",
    ),
  ).toEqual({
    ok: true,
    code: "const twoSum = (nums: number[], target: number): number[] => {\n  return [];\n};\n",
  });
});

it("reports the line of a syntax error instead of throwing", async () => {
  const result = await formatCode("function f() {\n  return (1;\n}", "javascript");
  expect(result).toMatchObject({ ok: false, line: 2 });
});
