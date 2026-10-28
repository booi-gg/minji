import { chromium } from "playwright";

const origin = process.argv[2] ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await page.waitForURL(/\/w\//);
  await page.locator("main.practice").waitFor();

  await context.setOffline(true);
  await page.reload();
  await page.locator("main.practice").waitFor({ timeout: 10_000 });
  if (!(await page.getByText("Offline", { exact: true }).isVisible()))
    throw new Error("Offline status is not visible");

  await page.goto(origin);
  await page.getByRole("heading", { name: "My workspaces" }).waitFor();
  if ((await page.locator(".workspace-row").count()) !== 1)
    throw new Error("The offline workspace did not load from IndexedDB");

  const runner = await context.newPage();
  await runner.goto(`${origin}/runner.html`);
  if ((await runner.locator('meta[http-equiv="Content-Security-Policy"]').count()) !== 1)
    throw new Error("The offline runner did not load from the service worker cache");

  process.stdout.write("Offline app shell, saved workspace, and runner passed.\n");
} finally {
  await browser.close();
}
