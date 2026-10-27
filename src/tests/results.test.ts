import { describe, expect, it } from "vite-plus/test";
import type { RawTestResult } from "../runner/types.ts";
import { createWorkspace, type TestCase } from "../workspaces/model.ts";
import {
  compileErrorMessage,
  prepareRun,
  summarize,
  toTestResult,
  type TestResult,
} from "./results.ts";

const workspace = createWorkspace({
  functionName: "twoSum",
  params: ["nums", "target"],
  source: "code",
});

const test = (position: number, argsText: string, expectedText: string, label = ""): TestCase => ({
  id: `t${position}`,
  workspaceId: workspace.id,
  position,
  label,
  argsText,
  expectedText,
  compare: { kind: "return" },
});

const raw = (overrides: Partial<RawTestResult>): RawTestResult => ({
  testId: "t0",
  kind: "returned",
  console: [],
  consoleTruncated: false,
  durationMs: 3,
  ...overrides,
});

const result = (status: TestResult["status"], label = "Test 1"): TestResult => ({
  testId: label,
  label,
  status,
  console: [],
  consoleTruncated: false,
  durationMs: 1,
});

describe("prepareRun", () => {
  it("builds a request from valid tests and reports invalid ones without running them", () => {
    const tests = [test(0, "[[2,7], 9]", "[0,1]"), test(1, "[1,", "0", "broken")];
    const prepared = prepareRun(workspace, tests, { kind: "all" }, "run-1");
    if (prepared.kind !== "ready") throw new Error(prepared.message);
    expect(prepared.request).toMatchObject({
      runId: "run-1",
      functionName: "twoSum",
      tests: [{ id: "t0", argsJson: "[[2,7], 9]", capture: { kind: "return" } }],
    });
    expect(prepared.expected.get("t0")).toEqual([0, 1]);
    expect(prepared.invalid).toMatchObject([
      { testId: "t1", label: "broken", status: "invalid-test" },
    ]);
  });

  it("selects one test for a single run", () => {
    const tests = [test(0, "[]", "1"), test(1, "[]", "2")];
    const prepared = prepareRun(workspace, tests, { kind: "single", testId: "t1" }, "run-1");
    expect(prepared.kind === "ready" && prepared.request.tests.map((entry) => entry.id)).toEqual([
      "t1",
    ]);
  });

  it("rejects runs that can't start", () => {
    expect(prepareRun(workspace, [], { kind: "all" }, "r")).toEqual({
      kind: "rejected",
      message: "Add a test to run.",
    });
    expect(
      prepareRun(
        { ...workspace, source: "x".repeat(100_001) },
        [test(0, "[]", "1")],
        { kind: "all" },
        "r",
      ),
    ).toEqual({
      kind: "rejected",
      message: "Your code is larger than the 100 KB limit.",
    });
    expect(
      prepareRun({ ...workspace, functionName: "1x" }, [test(0, "[]", "1")], { kind: "all" }, "r")
        .kind,
    ).toBe("rejected");
  });
});

describe("toTestResult", () => {
  it("compares returned values", () => {
    const passing = toTestResult(raw({ value: [0, 1] }), test(0, "[]", "[0,1]"), [0, 1]);
    expect(passing).toMatchObject({ status: "passed", label: "Test 1", durationMs: 3 });
    const failing = toTestResult(raw({ value: [0, 2] }), test(0, "[]", "[0,1]"), [0, 1]);
    expect(failing).toMatchObject({ status: "failed", diffPath: "[1]", actual: [0, 2] });
  });

  it("maps runner kinds to statuses", () => {
    const error = { name: "TypeError", message: "boom" };
    expect(toTestResult(raw({ kind: "threw", error }), test(0, "[]", "1"), 1)).toMatchObject({
      status: "error",
      error,
    });
    expect(
      toTestResult(raw({ kind: "timeout", durationMs: 2000 }), test(0, "[]", "1"), 1),
    ).toMatchObject({
      status: "timeout",
      durationMs: 2000,
    });
    expect(toTestResult(raw({ kind: "stopped" }), test(0, "[]", "1"), 1)).toMatchObject({
      status: "stopped",
      durationMs: null,
    });
    expect(
      toTestResult(
        raw({ kind: "non-serializable", nonSerializable: { path: "", type: "Map" } }),
        test(0, "[]", "1"),
        1,
      ),
    ).toMatchObject({ status: "non-serializable", nonSerializable: { type: "Map" } });
  });
});

describe("summarize", () => {
  it("uses the spec's wording for full runs", () => {
    expect(summarize("all", [result("passed"), result("passed")])).toBe("Passed all 2 tests");
    expect(summarize("all", [result("passed")])).toBe("Passed 1 test");
    expect(summarize("all", [result("passed"), result("failed"), result("timeout")])).toBe(
      "Passed 1 of 3 tests",
    );
    expect(summarize("all", [result("passed"), result("invalid-test")])).toBe(
      "Passed 1 of 2 tests · 1 invalid test skipped",
    );
  });

  it("names the test for single runs", () => {
    expect(summarize("single", [result("passed", "edge")])).toBe('Test "edge" passed');
    expect(summarize("single", [result("timeout", "big")])).toBe('Test "big" timed out');
  });

  it("formats compile errors", () => {
    expect(compileErrorMessage("Unexpected token", 4, 2)).toBe(
      "Didn't run: syntax error on line 4, column 2: Unexpected token",
    );
  });
});
