import { expect, it } from "vite-plus/test";
import compileError from "./fixtures/compile-error.ts?raw";
import { transformSource } from "./transform.ts";

it("strips types and keeps line numbers", () => {
  const result = transformSource("function f(a: number,\n  b: string): void {\n}", "typescript");
  expect(result.ok).toBe(true);
  expect(result.ok && result.code.split("\n")).toHaveLength(3);
  expect(result.ok && result.code).not.toContain("number");
});

it("reports the location of a syntax error", () => {
  expect(transformSource(compileError, "typescript")).toMatchObject({ ok: false, line: 2 });
});

it("rejects TypeScript syntax in JavaScript mode", () => {
  expect(transformSource("function f(a: number) {}", "javascript").ok).toBe(false);
});
