// End-to-end check of the step 3 gate in Chromium, Firefox and WebKit: imports workspaces
// through the UI, runs their tests, and prints each result.
// Usage: start `vp dev`, then `vpx ./scripts/e2e-runs.ts http://localhost:8000`
import { chromium, firefox, webkit, type Browser, type Page } from "playwright";

const base = process.argv[2] ?? "http://localhost:8000";

const gateSource = `function solve(kind: string): unknown {
  switch (kind) {
    case "ok": return 42;
    case "wrong": return 41;
    case "throw": return helper();
    case "hang": while (true) {}
    case "log":
      for (let i = 0; i < 3; i++) console.log("step", i, { i });
      console.warn("careful");
      return 1;
    case "big": return "x".repeat(9_000_000);
    default: return null;
  }
}
function helper(): never {
  throw new RangeError("bad input");
}
`;

const exportFile = (workspace: Record<string, unknown>): string =>
  JSON.stringify({
    format: "minji.workspaces",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspaces: [workspace],
  });

const gate = exportFile({
  title: "Gate",
  language: "typescript",
  functionName: "solve",
  params: ["kind"],
  source: gateSource,
  testTimeoutMs: 1000,
  tests: [
    { label: "correct", args: ["ok"], expected: 42 },
    { label: "wrong", args: ["wrong"], expected: 42 },
    { label: "throws", args: ["throw"], expected: 0 },
    { label: "hangs", args: ["hang"], expected: 0 },
    { label: "logs", args: ["log"], expected: 1 },
    // A string in the file is raw editor text, so a JSON string is written with its quotes.
    { label: "oversized", args: ["big"], expected: '""' },
    { label: "invalid", args: "[1,", expected: 0 },
  ],
});

const compileError = exportFile({
  title: "Broken",
  language: "javascript",
  functionName: "solve",
  source: "function solve() {\n  return (1;\n}\n",
  tests: [{ args: [], expected: 1 }],
});

const importWorkspace = async (page: Page, file: string): Promise<void> => {
  await page.goto(`${base}/new/import`);
  await page.getByRole("tab", { name: "Upload file" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(file),
  });
  await page.getByRole("button", { name: "Save problem" }).click();
  // Client-side navigation: wait for the URL, not a page load.
  await page.waitForURL(/\/w\//, { waitUntil: "commit" });
  await page.locator(".monaco-editor").waitFor();
};

const runAll = async (page: Page): Promise<string> => {
  await page.getByRole("button", { name: "Run all" }).click();
  // The toolbar shows Stop while running and Run all again when done.
  await page.getByRole("button", { name: "Run all" }).waitFor({ timeout: 60_000 });
  return (await page.locator(".summary").textContent()) ?? "";
};

const rows = async (page: Page): Promise<{ rows: string[]; stdout: string }> => {
  const tabs = page.locator('.case-picker[aria-label="Test results"] .case-tab-select');
  const rows: string[] = [];
  let stdout = "";
  for (let index = 0; index < (await tabs.count()); index += 1) {
    await tabs.nth(index).click();
    const row = page.locator(".result-row");
    const status = (await tabs.nth(index).locator(".visually-hidden").textContent()) ?? "";
    const label = (await tabs.nth(index).locator(".case-label").textContent()) ?? "";
    stdout +=
      (await row
        .locator(".console-lines")
        .textContent()
        .catch(() => "")) ?? "";
    const detail =
      (
        await row
          .locator(".result-detail")
          .textContent()
          .catch(() => "")
      )
        ?.replaceAll(/\s+/g, " ")
        .trim() ?? "";
    rows.push(`${label}: ${status}${detail === "" ? "" : ` — ${detail.slice(0, 110)}`}`);
  }
  return { rows, stdout };
};

const check = async (name: string, launch: () => Promise<Browser>): Promise<boolean> => {
  const browser = await launch();
  const page = await browser.newPage();
  let ok = true;
  const expect = (condition: boolean, what: string): void => {
    if (!condition) {
      ok = false;
      process.stdout.write(`  ✗ ${what}\n`);
    }
  };
  try {
    process.stdout.write(`\n${name}\n`);
    await importWorkspace(page, gate);
    expect(
      (await page.getByRole("textbox", { name: "kind =" }).inputValue()) === '"ok"',
      "named input field",
    );
    await page.locator('.case-picker[aria-label="Test cases"] .case-tab-select').nth(1).click();
    expect(
      (await page.getByRole("textbox", { name: "kind =" }).inputValue()) === '"wrong"',
      "case picker changes input",
    );
    const summary = await runAll(page);
    const { rows: results, stdout } = await rows(page);
    process.stdout.write(`  summary: ${summary}\n${results.map((row) => `  ${row}`).join("\n")}\n`);
    const statusOf = (label: string) => results.find((row) => row.startsWith(`${label}:`)) ?? "";
    expect(summary === "Passed 2 of 7 tests · 1 invalid test skipped", "summary");
    expect(statusOf("correct").includes("Passed"), "correct passes");
    expect(statusOf("wrong").includes("Failed"), "wrong fails");
    expect(statusOf("throws").includes("RangeError: bad input"), "throws shows the error");
    expect(statusOf("hangs").includes("Timed out"), "hang times out");
    expect(statusOf("logs").includes("Passed"), "logs passes");
    expect(statusOf("oversized").includes("Too large"), "oversized output");
    expect(statusOf("invalid").includes("Invalid test"), "invalid test");

    expect(stdout.includes("step 0 {i: 0}") && stdout.includes("careful"), "console output");

    const lastRun = await page.evaluate(async () => {
      const response = indexedDB.open("minji");
      const db = await new Promise<IDBDatabase>(
        (resolve) => (response.onsuccess = () => resolve(response.result)),
      );
      const all = await new Promise<{ title: string; lastRun: unknown }[]>((resolve) => {
        const request = db.transaction("workspaces").objectStore("workspaces").getAll();
        request.onsuccess = () => resolve(request.result as { title: string; lastRun: unknown }[]);
      });
      return all.find((workspace) => workspace.title === "Gate")?.lastRun;
    });
    expect(JSON.stringify(lastRun).includes('"passed":2,"total":7'), "lastRun stored");

    await importWorkspace(page, compileError);
    const brokenSummary = await runAll(page);
    process.stdout.write(`  compile error: ${brokenSummary}\n`);
    expect(brokenSummary.startsWith("Didn't run: syntax error on line 2"), "compile error message");
    expect(
      await page.getByRole("button", { name: "Go to line 2" }).isVisible(),
      "go to line button",
    );
  } catch (error) {
    ok = false;
    process.stdout.write(`  ✗ ${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    await browser.close();
  }
  return ok;
};

const results = [
  await check("chromium", () => chromium.launch()),
  await check("firefox", () => firefox.launch()),
  await check("webkit", () => webkit.launch()),
];
process.stdout.write(
  results.every(Boolean) ? "\nAll browsers passed.\n" : "\nSome checks failed.\n",
);
process.exitCode = results.every(Boolean) ? 0 : 1;
