import { expect, it } from "vite-plus/test";
import { createWorkspace, displayTitle, scratchStub } from "./model.ts";

it("builds the scratch stub with the cursor line indented", () => {
  expect(scratchStub("solve")).toBe("function solve() {\n  \n}\n");
  expect(scratchStub("twoSum", ["nums", "target"])).toBe(
    "function twoSum(nums, target) {\n  \n}\n",
  );
});

it("creates a scratch workspace with the documented defaults", () => {
  const now = new Date("2026-10-27T10:00:00.000Z");
  const workspace = createWorkspace({}, now);
  expect(workspace).toMatchObject({
    title: "",
    statement: "",
    notes: "",
    language: "typescript",
    functionName: "solve",
    params: [],
    source: "function solve() {\n  \n}\n",
    starterSource: "function solve() {\n  \n}\n",
    testTimeoutMs: 2000,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deletedAt: null,
    ownerId: null,
    syncRevision: 0,
    syncState: "local",
    lastRun: null,
  });
});

it("uses the imported source as starter when no starter is given", () => {
  expect(createWorkspace({ source: "code" })).toMatchObject({
    source: "code",
    starterSource: "code",
  });
});

it("shows Untitled for blank titles", () => {
  expect(displayTitle({ title: "  " })).toBe("Untitled");
  expect(displayTitle({ title: "Two Sum" })).toBe("Two Sum");
});
