// Throwaway step 0 page: benchmarks the chosen runner on a real device and shows that the
// page stays responsive while user code runs.
import { createRunner } from "../createRunner.ts";
import dpGrid from "../fixtures/dp-grid.ts?raw";
import infiniteLoop from "../fixtures/infinite-loop.js?raw";
import mergeSort from "../fixtures/merge-sort.ts?raw";
import twoSumTs from "../fixtures/two-sum.ts?raw";
import type { Language, RawTestResult, RunnerEvent } from "../types.ts";

interface BenchCase {
  name: string;
  source: string;
  language: Language;
  functionName: string;
  argsJson: () => string;
  testTimeoutMs?: number;
}

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id}`);
  return found as T;
};

const randomIntegers = (count: number): number[] =>
  Array.from({ length: count }, () => Math.floor(Math.random() * 1_000_000));

const cases: BenchCase[] = [
  {
    name: "two-sum (cold start on first click)",
    source: twoSumTs,
    language: "typescript",
    functionName: "twoSum",
    argsJson: () => "[[2,7,11,15],9]",
  },
  {
    name: "merge sort 10^5",
    source: mergeSort,
    language: "typescript",
    functionName: "mergeSort",
    argsJson: () => JSON.stringify([randomIntegers(100_000)]),
  },
  {
    name: "merge sort 10^6",
    source: mergeSort,
    language: "typescript",
    functionName: "mergeSort",
    argsJson: () => JSON.stringify([randomIntegers(1_000_000)]),
  },
  {
    name: "DP grid 1000 x 1000",
    source: dpGrid,
    language: "typescript",
    functionName: "uniquePaths",
    argsJson: () => "[1000,1000]",
  },
  {
    name: "infinite loop (2 s timeout)",
    source: infiniteLoop,
    language: "javascript",
    functionName: "spin",
    argsJson: () => "[]",
    testTimeoutMs: 2000,
  },
];

const runner = createRunner();
let runCount = 0;

const runOnce = async (
  input: Omit<BenchCase, "name" | "argsJson"> & { argsJson: string },
): Promise<{ events: RunnerEvent[]; elapsedMs: number }> => {
  runCount += 1;
  const events: RunnerEvent[] = [];
  const started = performance.now();
  await runner.run(
    {
      runId: `bench-${runCount}`,
      language: input.language,
      source: input.source,
      functionName: input.functionName,
      testTimeoutMs: input.testTimeoutMs ?? 10_000,
      tests: [{ id: "t", argsJson: input.argsJson, capture: { kind: "return" } }],
    },
    (event) => events.push(event),
  );
  return { events, elapsedMs: performance.now() - started };
};

const resultOf = (events: RunnerEvent[]): RawTestResult | undefined =>
  events.flatMap((event) => (event.type === "test-result" ? [event.result] : []))[0];

const summarise = (events: RunnerEvent[]): string => {
  const result = resultOf(events);
  if (result !== undefined) return result.kind;
  return events[0]?.type ?? "no events";
};

// Heartbeat: a counter driven by requestAnimationFrame, plus the largest gap between frames.
let beats = 0;
let lastFrame = performance.now();
let maxGap = 0;
const tick = (now: number): void => {
  beats += 1;
  maxGap = Math.max(maxGap, now - lastFrame);
  lastFrame = now;
  element("heartbeat").textContent = String(beats);
  element("gap").textContent = String(Math.round(maxGap));
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

element<HTMLButtonElement>("bench").addEventListener("click", async () => {
  const rows = element("bench-rows");
  rows.replaceChildren();
  maxGap = 0;
  for (const benchCase of cases) {
    const { events, elapsedMs } = await runOnce({ ...benchCase, argsJson: benchCase.argsJson() });
    const row = document.createElement("tr");
    const result = resultOf(events);
    for (const [text, numeric] of [
      [benchCase.name, false],
      [summarise(events), false],
      [result === undefined ? "–" : String(Math.round(result.durationMs)), true],
      [String(Math.round(elapsedMs)), true],
    ] as const) {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (numeric) cell.className = "number";
      row.append(cell);
    }
    rows.append(row);
  }
});

const sourceField = element<HTMLTextAreaElement>("source");
sourceField.value = infiniteLoop;

element<HTMLButtonElement>("run").addEventListener("click", async () => {
  const output = element("output");
  output.textContent = "Running…";
  const { events, elapsedMs } = await runOnce({
    source: sourceField.value,
    language: element<HTMLSelectElement>("language").value as Language,
    functionName: element<HTMLInputElement>("function-name").value,
    argsJson: element<HTMLInputElement>("args").value,
    testTimeoutMs: 2000,
  });
  output.textContent = `${Math.round(elapsedMs)} ms\n${JSON.stringify(events, null, 2)}`;
});

element<HTMLButtonElement>("stop").addEventListener("click", () => runner.stop());
