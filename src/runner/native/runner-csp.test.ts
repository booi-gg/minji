/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { declaredHashOf, hashOf, inlineScriptOf } from "./runner-csp.ts";

it("runner.html allows exactly its own inline script", () => {
  const html = readFileSync(new URL("../../../public/runner.html", import.meta.url), "utf8");
  // If this fails, run: vpx ./scripts/update-runner-csp.ts
  expect(declaredHashOf(html)).toBe(hashOf(inlineScriptOf(html)));
});
