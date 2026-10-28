// Step 4 gate: paste a problem, review named arguments, save, and run its tests.
// Usage: start `vp dev`, then `vpx ./scripts/e2e-import.ts http://127.0.0.1:8000`
import { chromium, firefox, webkit, type Browser } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:8000";
const statement = `Pair With Target Sum
Return the indices of two entries that add up to target.

Example 1:
Input: target = 9, nums = [3,8,1,5]
Output: [1,2]

Example 2:
Input: nums = [5,5], target = 10
Output: [0,1]
`;
const source = `function pairWithSum(nums: number[], target: number): number[] {
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i] + nums[j] === target) return [i, j];
    }
  }
  return [];
}
`;

const check = async (name: string, launch: () => Promise<Browser>): Promise<void> => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/new/import`);
    await page.getByRole("textbox", { name: "Problem text or Markdown" }).fill(statement);
    await page.getByRole("textbox", { name: "Starter code (optional)" }).fill(source);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Review import" }).waitFor();
    const args = await page
      .getByRole("textbox", { name: "Arguments (JSON array)" })
      .evaluateAll((elements) => elements.map((element) => (element as HTMLTextAreaElement).value));
    if (args[0] !== "[[3,8,1,5], 9]" || args[1] !== "[[5,5], 10]") {
      throw new Error(`Incorrect argument mapping: ${JSON.stringify(args)}`);
    }
    await page.getByRole("button", { name: "Save problem" }).click();
    await page.waitForURL(/\/w\//);
    await page.getByRole("button", { name: "Run all" }).click();
    await page.getByRole("button", { name: "Stop" }).waitFor();
    await page.getByRole("button", { name: "Run all" }).waitFor({ timeout: 60_000 });
    const summary = await page.locator(".summary").textContent();
    if (!summary?.includes("Passed all 2 tests")) {
      const details = await page.locator(".result-row").allTextContents();
      throw new Error(`Unexpected run summary: ${summary}; ${JSON.stringify(details)}`);
    }
    process.stdout.write(`${name}: import and run passed\n`);
  } finally {
    await browser.close();
  }
};

await check("Chromium", () => chromium.launch());
await check("Firefox", () => firefox.launch());
await check("WebKit", () => webkit.launch());
