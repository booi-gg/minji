import { afterAll, describe, expect, it } from "vite-plus/test";
import compileError from "./fixtures/compile-error.ts?raw";
import consoleFlood from "./fixtures/console-flood.js?raw";
import deepRecursion from "./fixtures/deep-recursion.js?raw";
import dpGrid from "./fixtures/dp-grid.ts?raw";
import engineSyntaxError from "./fixtures/engine-syntax-error.js?raw";
import exportDefault from "./fixtures/export-default.ts?raw";
import globalLeak from "./fixtures/global-leak.js?raw";
import importLodash from "./fixtures/import-lodash.ts?raw";
import inPlace from "./fixtures/in-place.js?raw";
import infiniteLoop from "./fixtures/infinite-loop.js?raw";
import isolation from "./fixtures/isolation.js?raw";
import mergeSort from "./fixtures/merge-sort.ts?raw";
import returnsSpecial from "./fixtures/returns-special.js?raw";
import throws from "./fixtures/throws.js?raw";
import twoSumJs from "./fixtures/two-sum.js?raw";
import twoSumTs from "./fixtures/two-sum.ts?raw";
import { createNativeRunner } from "./native/runner.ts";
import type {
  CompareTarget,
  Language,
  RawTestResult,
  RunRequest,
  Runner,
  RunnerEvent,
} from "./types.ts";

interface CaseTest {
  args: unknown[] | string;
  capture?: CompareTarget;
}

interface CaseRequest {
  source: string;
  functionName: string;
  language?: Language;
  tests: CaseTest[];
  testTimeoutMs?: number;
}

interface Outcome {
  events: RunnerEvent[];
  results: RawTestResult[];
  end: RunnerEvent | undefined;
  elapsedMs: number;
}

let runCounter = 0;

const toRequest = (input: CaseRequest): RunRequest => {
  runCounter += 1;
  return {
    runId: `run-${runCounter}`,
    language: input.language ?? "javascript",
    source: input.source,
    functionName: input.functionName,
    testTimeoutMs: input.testTimeoutMs ?? 2000,
    tests: input.tests.map((test, index) => ({
      id: `t${index}`,
      argsJson: typeof test.args === "string" ? test.args : JSON.stringify(test.args),
      capture: test.capture ?? { kind: "return" },
    })),
  };
};

const execute = async (runner: Runner, input: CaseRequest): Promise<Outcome> => {
  const events: RunnerEvent[] = [];
  const started = performance.now();
  await runner.run(toRequest(input), (event) => events.push(event));
  return {
    events,
    results: events.flatMap((event) => (event.type === "test-result" ? [event.result] : [])),
    end: events.at(-1),
    elapsedMs: performance.now() - started,
  };
};

const valueOf = (outcome: Outcome, index = 0): unknown => outcome.results[index]?.value;

// Deterministic pseudo-random integers, so every browser sorts the same input.
const randomIntegers = (count: number): number[] => {
  let seed = 12_345;
  const values = Array.from<number>({ length: count });
  for (let index = 0; index < count; index += 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    values[index] = seed % 1_000_000;
  }
  return values;
};

const isSorted = (values: unknown): boolean =>
  Array.isArray(values) &&
  values.every((value, index) => index === 0 || (values[index - 1] as number) <= (value as number));

const uniquePaths = (m: number, n: number): number => {
  const row = Array.from({ length: n }, () => 1);
  for (let r = 1; r < m; r += 1) {
    for (let c = 1; c < n; c += 1) row[c] = ((row[c] ?? 0) + (row[c - 1] ?? 0)) % 1_000_000_007;
  }
  return row[n - 1] ?? 0;
};

const browserName = (): string => {
  const agent = navigator.userAgent;
  if (agent.includes("Firefox")) return "firefox";
  if (agent.includes("Chrome")) return "chromium";
  return "webkit";
};

/** Largest gap between 10 ms timer ticks on the page thread while `work` runs. */
const maxMainThreadGap = async (work: () => Promise<unknown>): Promise<number> => {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);
  await work();
  clearInterval(timer);
  return maxGap;
};

const benchmarks: Record<string, Record<string, number | string>> = {};
const record = (candidate: string, key: string, value: number | string): void => {
  benchmarks[candidate] ??= {};
  const entry = benchmarks[candidate];
  entry[key] = typeof value === "number" ? Math.round(value) : value;
};

afterAll(() => {
  // Collected into specs/runner-decision.md.
  console.info(`BENCHMARK ${browserName()} ${JSON.stringify(benchmarks)}`);
});

const candidate = "native";
const create = (budget?: number): Runner =>
  createNativeRunner(budget === undefined ? {} : { runBudgetMs: () => budget });

describe("native runner", () => {
  const runner = create();
  afterAll(() => runner.dispose());

  it("runs TypeScript and records cold and warm times", async () => {
    const twoSum: CaseRequest = {
      source: twoSumTs,
      functionName: "twoSum",
      language: "typescript",
      tests: [{ args: [[2, 7, 11, 15], 9] }, { args: [[3, 2, 4], 6] }],
    };
    const cold = await execute(runner, twoSum);
    expect(cold.end).toMatchObject({ type: "run-complete", stopped: false });
    expect(valueOf(cold, 0)).toEqual([0, 1]);
    expect(valueOf(cold, 1)).toEqual([1, 2]);
    const warm = await execute(runner, twoSum);
    expect(valueOf(warm, 1)).toEqual([1, 2]);
    record(candidate, "coldRunMs", cold.elapsedMs);
    record(candidate, "warmRunMs", warm.elapsedMs);
  });

  it("runs a var-assigned JavaScript function", async () => {
    const outcome = await execute(runner, {
      source: twoSumJs,
      functionName: "twoSum",
      tests: [{ args: [[3, 3], 6] }],
    });
    expect(valueOf(outcome)).toEqual([0, 1]);
  });

  it("falls back to the default export", async () => {
    const outcome = await execute(runner, {
      source: exportDefault,
      functionName: "solution",
      language: "typescript",
      tests: [{ args: [21] }],
    });
    expect(valueOf(outcome)).toBe(42);
  });

  it("ends the run on imports", async () => {
    const outcome = await execute(runner, {
      source: importLodash,
      functionName: "solve",
      language: "typescript",
      tests: [{ args: [[1, 2]] }],
    });
    expect(outcome.events).toEqual([
      expect.objectContaining({ type: "imports-unsupported", specifier: "lodash" }),
      expect.objectContaining({ type: "run-complete" }),
    ]);
  });

  it("reports syntax errors found by sucrase", async () => {
    const outcome = await execute(runner, {
      source: compileError,
      functionName: "broken",
      language: "typescript",
      tests: [{ args: [[1]] }],
    });
    expect(outcome.events[0]).toMatchObject({ type: "compile-error", line: 2 });
    expect(outcome.results).toHaveLength(0);
  });

  it("reports syntax errors found by the engine", async () => {
    const outcome = await execute(runner, {
      source: engineSyntaxError,
      functionName: "sum",
      tests: [{ args: [1, 2] }, { args: [3, 4] }],
    });
    expect(outcome.events[0]).toMatchObject({ type: "compile-error" });
    expect(outcome.results).toHaveLength(0);
    expect(outcome.end).toMatchObject({ type: "run-complete" });
  });

  it("sorts 10^5 and 10^6 integers", async () => {
    for (const size of [100_000, 1_000_000]) {
      const outcome = await execute(runner, {
        source: mergeSort,
        functionName: "mergeSort",
        language: "typescript",
        testTimeoutMs: 10_000,
        tests: [{ args: JSON.stringify([randomIntegers(size)]) }],
      });
      const [result] = outcome.results;
      expect(result?.kind).toBe("returned");
      expect(isSorted(result?.value)).toBe(true);
      expect(result?.value).toHaveLength(size);
      record(candidate, `mergeSort${size}CallMs`, result?.durationMs ?? -1);
      record(candidate, `mergeSort${size}RunMs`, outcome.elapsedMs);
    }
  });

  it("fills a 1000 x 1000 DP grid", async () => {
    const outcome = await execute(runner, {
      source: dpGrid,
      functionName: "uniquePaths",
      language: "typescript",
      testTimeoutMs: 10_000,
      tests: [{ args: [1000, 1000] }],
    });
    expect(valueOf(outcome)).toBe(uniquePaths(1000, 1000));
    record(candidate, "dpGrid1000CallMs", outcome.results[0]?.durationMs ?? -1);
  });

  it("handles recursion depth 2000 and reports overflow at 10^6", async () => {
    const outcome = await execute(runner, {
      source: deepRecursion,
      functionName: "depth",
      testTimeoutMs: 5000,
      tests: [{ args: [2000] }, { args: [1_000_000] }],
    });
    expect(outcome.results[0]).toMatchObject({ kind: "returned", value: 2000 });
    expect(outcome.results[1]?.kind).toBe("stack-overflow");
  });

  it("times out an infinite loop and keeps the page responsive", async () => {
    let outcome: Outcome | undefined;
    const gap = await maxMainThreadGap(async () => {
      outcome = await execute(runner, {
        source: infiniteLoop,
        functionName: "spin",
        testTimeoutMs: 500,
        tests: [{ args: [] }],
      });
    });
    expect(outcome?.results[0]?.kind).toBe("timeout");
    expect(outcome?.elapsedMs).toBeLessThan(500 + 1500);
    expect(gap).toBeLessThan(200);
    record(candidate, "infiniteLoopRunMs", outcome?.elapsedMs ?? -1);
    record(candidate, "maxMainThreadGapMs", gap);
  });

  it("kills a run that outlives the watchdog budget and recovers", async () => {
    const strict = create(1000);
    try {
      const outcome = await execute(strict, {
        source: infiniteLoop,
        functionName: "spin",
        testTimeoutMs: 5000,
        tests: [{ args: [] }],
      });
      expect(outcome.end).toMatchObject({ type: "crashed", reason: "watchdog" });
      expect(outcome.elapsedMs).toBeLessThan(1000 + 1000);
      record(candidate, "watchdogRunMs", outcome.elapsedMs);
      const after = await execute(strict, {
        source: twoSumJs,
        functionName: "twoSum",
        tests: [{ args: [[1, 2], 3] }],
      });
      expect(valueOf(after)).toEqual([0, 1]);
    } finally {
      strict.dispose();
    }
  });

  it("stops a run on request", async () => {
    const pending = execute(runner, {
      source: infiniteLoop,
      functionName: "spin",
      testTimeoutMs: 5000,
      tests: [{ args: [] }, { args: [] }],
    });
    setTimeout(() => runner.stop(), 300);
    const outcome = await pending;
    expect(outcome.results.map((result) => result.kind)).toEqual(["stopped", "stopped"]);
    expect(outcome.end).toMatchObject({ type: "run-complete", stopped: true });
    const after = await execute(runner, {
      source: twoSumJs,
      functionName: "twoSum",
      tests: [{ args: [[1, 2], 3] }],
    });
    expect(valueOf(after)).toEqual([0, 1]);
  });

  it("compares an argument mutated in place", async () => {
    const outcome = await execute(runner, {
      source: inPlace,
      functionName: "moveZeroes",
      tests: [{ args: [[0, 1, 0, 3, 12]], capture: { kind: "argument", index: 0 } }],
    });
    expect(valueOf(outcome)).toEqual([1, 3, 12, 0, 0]);
  });

  it("encodes special values", async () => {
    const kinds = ["undefined", "nan", "negative-zero", "holes", "map", "cycle"];
    const outcome = await execute(runner, {
      source: returnsSpecial,
      functionName: "special",
      tests: kinds.map((kind) => ({ args: [kind] })),
    });
    expect(outcome.results.map((result) => result.value ?? result.kind)).toEqual([
      { $minji: "undefined" },
      { $minji: "NaN" },
      { $minji: "-0" },
      [1, { $minji: "undefined" }, 3],
      "non-serializable",
      "non-serializable",
    ]);
    expect(outcome.results[5]?.nonSerializable).toEqual({
      path: "[1]",
      type: "circular reference",
    });
  });

  it("caps console output", async () => {
    const outcome = await execute(runner, {
      source: consoleFlood,
      functionName: "flood",
      tests: [{ args: [10_000] }],
    });
    const [result] = outcome.results;
    const used = (result?.console ?? []).reduce((total, entry) => total + entry.text.length + 1, 0);
    expect(result?.consoleTruncated).toBe(true);
    expect(used).toBeLessThanOrEqual(16_384);
    expect(result?.value).toBe(10_000);
  });

  it("gives each test fresh globals", async () => {
    const outcome = await execute(runner, {
      source: globalLeak,
      functionName: "leak",
      tests: [{ args: [true] }, { args: [false] }],
    });
    expect(outcome.results.map((result) => result.value)).toEqual(["number", "undefined"]);
  });

  it("reports thrown errors with console output", async () => {
    const outcome = await execute(runner, {
      source: throws,
      functionName: "explode",
      tests: [{ args: ["boom"] }],
    });
    expect(outcome.results[0]).toMatchObject({
      kind: "threw",
      error: { name: "TypeError", message: "boom" },
      console: [{ level: "error", text: "before throw" }],
    });
  });

  it("reports a missing function", async () => {
    const outcome = await execute(runner, {
      source: twoSumJs,
      functionName: "threeSum",
      tests: [{ args: [] }],
    });
    expect(outcome.results[0]?.kind).toBe("missing-function");
  });

  it("keeps user code away from storage, network and the page", async () => {
    const outcome = await execute(runner, {
      source: isolation,
      functionName: "probe",
      tests: [{ args: [location.origin] }],
    });
    const probe = outcome.results[0]?.value as Record<string, string>;
    record(candidate, "isolation", JSON.stringify(probe));
    expect(probe.indexedDB).not.toBe("allowed");
    expect(probe.syncXhr).not.toBe("allowed");
    expect(probe.importScripts).not.toBe("allowed");
    expect(probe.document).toBe("absent");
    expect(probe.localStorage).toBe("absent");
  });
});
