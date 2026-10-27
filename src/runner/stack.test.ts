import { expect, it } from "vite-plus/test";
import { formatFrame, userFrames } from "./stack.ts";

// Real stacks from the runner: helper() throws on line 3 and is called by solve() on line 6.
const V8 = [
  "RangeError: bad 3",
  "    at helper (eval at self.onmessage (blob:null/7197c5ac:350:12), <anonymous>:5:9)",
  "    at solve (eval at self.onmessage (blob:null/7197c5ac:350:12), <anonymous>:8:10)",
  "    at globalThis.__minjiRun (blob:null/7197c5ac:317:21)",
  "    at self.onmessage (blob:null/7197c5ac:355:47)",
].join("\n");

const SPIDERMONKEY = [
  "helper@blob:null/0e191f58 line 350 > Function:5:9",
  "solve@blob:null/0e191f58 line 350 > Function:8:10",
  "globalThis.__minjiRun@blob:null/0e191f58:317:21",
  "self.onmessage@blob:null/0e191f58:355:47",
  "EventHandlerNonNull*@blob:null/0e191f58:344:1",
].join("\n");

const JSC = ["helper@", "@blob:null/e0438867:317:26", "@blob:null/e0438867:355:57"].join("\n");

it("maps V8 frames to the user's lines", () => {
  expect(userFrames(V8)).toEqual([
    { name: "helper", line: 3, column: 9 },
    { name: "solve", line: 6, column: 10 },
  ]);
});

it("maps SpiderMonkey frames to the user's lines", () => {
  expect(userFrames(SPIDERMONKEY)).toEqual([
    { name: "helper", line: 3, column: 9 },
    { name: "solve", line: 6, column: 10 },
  ]);
});

it("keeps JavaScriptCore frame names without locations", () => {
  expect(userFrames(JSC)).toEqual([{ name: "helper" }]);
});

it("treats eval and anonymous frames as top-level code", () => {
  const v8 =
    "TypeError: x\n    at eval (eval at self.onmessage (blob:null/a:350:12), <anonymous>:4:6)";
  const spiderMonkey = "anonymous@blob:null/d line 350 > Function:4:1";
  expect(userFrames(v8)).toEqual([{ name: undefined, line: 2, column: 6 }]);
  expect(userFrames(spiderMonkey)).toEqual([{ name: undefined, line: 2, column: 1 }]);
  expect(formatFrame({ name: undefined, line: 2 })).toBe("at (top level) (line 2)");
  expect(formatFrame({ name: "helper" })).toBe("at helper");
});

it("returns nothing for missing stacks", () => {
  expect(userFrames(undefined)).toEqual([]);
});
