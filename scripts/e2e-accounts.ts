// UI gate for account sync. API routes are fulfilled by one shared in-memory server,
// so two isolated browser contexts exercise the client without GitHub credentials.
// Usage: vpx ./scripts/e2e-accounts.ts http://localhost:8000
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page, type Route } from "playwright";
import type { RevisionDto, WorkspaceDoc } from "../src/sync/protocol.ts";

const base = process.argv[2] ?? "http://localhost:8000";
const account = { id: "e2e-user", login: "e2e", avatarUrl: null };
interface Row {
  revision: number;
  seq: number;
  deleted: boolean;
  doc: WorkspaceDoc | null;
  revisions: Map<string, RevisionDto>;
}
const rows = new Map<string, Row>();
let sequence = 0;
let holdSecondWrites = false;

const json = async (route: Route, status: number, body: unknown): Promise<void> => {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
};

const api =
  (device: "first" | "second" | "anonymous") =>
  async (route: Route): Promise<void> => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/me") {
      await json(
        route,
        device === "anonymous" ? 401 : 200,
        device === "anonymous" ? { error: "unauthenticated", message: "Sign in." } : account,
      );
      return;
    }
    if (device === "anonymous") {
      await json(route, 401, { error: "unauthenticated", message: "Sign in." });
      return;
    }
    if (path === "/api/workspaces" && method === "GET") {
      const since = Number(url.searchParams.get("since") ?? "0");
      const items = [...rows.entries()]
        .filter(([, row]) => row.seq > since)
        .sort(([, left], [, right]) => left.seq - right.seq)
        .slice(0, 100)
        .map(([id, row]) => ({
          id,
          revision: row.revision,
          seq: row.seq,
          deleted: row.deleted,
          doc: row.doc,
        }));
      await json(route, 200, { items, cursor: items.at(-1)?.seq ?? since, more: false });
      return;
    }
    const match = /^\/api\/workspaces\/([^/]+)(\/revisions)?$/.exec(path);
    if (match === null) {
      await json(route, 404, { error: "not_found", message: "Not found." });
      return;
    }
    const id = decodeURIComponent(match[1] ?? "");
    const row = rows.get(id);
    if (match[2] !== undefined) {
      if (row === undefined || row.deleted) {
        await json(route, 404, { error: "not_found", message: "Not found." });
        return;
      }
      if (method === "GET") {
        await json(route, 200, {
          items: [...row.revisions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        });
        return;
      }
      const body = request.postDataJSON() as { items: RevisionDto[] };
      for (const revision of body.items) row.revisions.set(revision.id, revision);
      await json(route, 200, { accepted: body.items.map((revision) => revision.id) });
      return;
    }
    if (device === "second" && holdSecondWrites) {
      await json(route, 503, { error: "unavailable", message: "Temporarily unavailable." });
      return;
    }
    const body = request.postDataJSON() as { baseRevision: number; doc?: WorkspaceDoc };
    const baseRevision = body.baseRevision;
    if ((row?.revision ?? 0) !== baseRevision || row?.deleted) {
      await json(route, 409, {
        error: "conflict",
        message: "Changed elsewhere.",
        revision: row?.revision ?? 0,
        deleted: row?.deleted ?? true,
        doc: row?.doc ?? null,
      });
      return;
    }
    sequence += 1;
    const next: Row = {
      revision: baseRevision + 1,
      seq: sequence,
      deleted: method === "DELETE",
      doc: method === "DELETE" ? null : (body.doc ?? null),
      revisions: method === "DELETE" ? new Map() : (row?.revisions ?? new Map()),
    };
    rows.set(id, next);
    await json(route, 200, { revision: next.revision, seq: next.seq });
  };

const pageFor = async (
  context: BrowserContext,
  device: "first" | "second" | "anonymous",
): Promise<Page> => {
  await context.route("**/api/**", api(device));
  const page = await context.newPage();
  await page.goto(base);
  if (device !== "anonymous") await page.getByText(account.login, { exact: true }).waitFor();
  return page;
};

const syncOnHome = async (page: Page): Promise<void> => {
  await page.goto(base);
  await page.locator(".account-menu summary").click();
  await page.getByRole("button", { name: "Sync now" }).click();
};

const run = async (): Promise<void> => {
  const browser = await chromium.launch();
  try {
    const first = await browser.newContext({ acceptDownloads: true });
    const second = await browser.newContext();
    const anonymous = await browser.newContext();
    const a = await pageFor(first, "first");
    await a.getByRole("button", { name: "Start from scratch" }).click();
    await a.waitForURL(/\/w\//);
    const workspacePath = new URL(a.url()).pathname;
    await a.getByRole("textbox", { name: "Title" }).fill("Shared workspace");
    await a.locator(".monaco-editor .view-lines").click();
    await a.keyboard.press("ControlOrMeta+A");
    await a.keyboard.insertText("function solve() { return 42; }");
    await a.getByRole("button", { name: "Add test" }).click();
    await a.getByRole("textbox", { name: "Expected" }).fill("42");
    await a.getByRole("button", { name: "Run all" }).click();
    await a.getByRole("button", { name: "Run all" }).waitFor({ timeout: 60_000 });
    const runSummary = await a.locator(".summary").innerText();
    assert.match(runSummary, /Passed 1 test/);
    assert.equal(
      await a.locator('.results-summary [role="status"]').getAttribute("aria-live"),
      "polite",
    );
    await a.reload();
    await a.getByRole("textbox", { name: "Title" }).waitFor();
    assert.equal(await a.getByRole("textbox", { name: "Title" }).inputValue(), "Shared workspace");
    assert.equal(await a.getByRole("textbox", { name: "Expected" }).inputValue(), "42");

    const downloadPromise = a.waitForEvent("download");
    await a.locator(".menu summary").click();
    await a.getByRole("button", { name: "Export workspace" }).click();
    const download = await downloadPromise;
    const exportPath = await download.path();
    assert.ok(exportPath);
    const c = await pageFor(anonymous, "anonymous");
    await c.goto(`${base}/new/import`);
    await c.getByRole("tab", { name: "Upload file" }).click();
    await c.locator('input[type="file"]').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/json",
      buffer: await readFile(exportPath),
    });
    await c.getByRole("button", { name: "Save workspace" }).click();
    await c.waitForURL(/\/w\//);
    assert.equal(await c.getByRole("textbox", { name: "Title" }).inputValue(), "Shared workspace");

    await syncOnHome(a);
    await a.getByText("Synced", { exact: true }).waitFor();
    assert.equal(rows.size, 1);
    const b = await pageFor(second, "second");
    await b.getByRole("link", { name: "Shared workspace" }).waitFor();
    await b.goto(`${base}${workspacePath}`);
    assert.equal(await b.getByRole("textbox", { name: "Expected" }).inputValue(), "42");
    await b.getByRole("button", { name: "History" }).click();
    await b.getByRole("dialog", { name: /History/ }).waitFor();
    await b.getByRole("button", { name: "Close" }).click();

    holdSecondWrites = true;
    await b.getByRole("textbox", { name: "Title" }).fill("Device B edit");
    await b.getByRole("link", { name: "All workspaces", exact: true }).click();
    await a.goto(`${base}${workspacePath}`);
    await a.getByRole("textbox", { name: "Title" }).fill("Device A edit");
    await a.getByRole("link", { name: "All workspaces", exact: true }).click();
    await syncOnHome(a);
    assert.equal([...rows.values()][0]?.doc?.title, "Device A edit");
    await syncOnHome(b);
    await b.getByText("Conflict", { exact: true }).waitFor();
    await b.goto(`${base}${workspacePath}`);
    await b.getByRole("button", { name: "Compare" }).click();
    await b.getByRole("dialog", { name: "Compare versions" }).waitFor();
    await b.keyboard.press("Escape");
    await b.getByRole("dialog", { name: "Compare versions" }).waitFor({ state: "hidden" });
    holdSecondWrites = false;
    await b.getByRole("button", { name: "Keep both" }).focus();
    await b.keyboard.press("Enter");
    await b.waitForURL(/\/w\//);
    await syncOnHome(b);
    await b.getByRole("link", { name: "Device B edit (copy)" }).waitFor();
    assert.equal(rows.size, 2);
    await c.goto(base);
    let focusedNew = false;
    for (let index = 0; index < 12; index += 1) {
      await c.keyboard.press("Tab");
      if ((await c.evaluate(() => document.activeElement?.getAttribute("href"))) === "/new") {
        focusedNew = true;
        break;
      }
    }
    assert.ok(focusedNew, "New workspace must be reachable by Tab");
    await c.keyboard.press("Enter");
    await c.waitForURL(`${base}/new`);
    console.info(
      "Account E2E passed: edit/run/refresh, export/import, second context, revisions, conflict and Keep both.",
    );
  } finally {
    await browser.close();
  }
};

await run();
