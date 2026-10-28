import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, it } from "vite-plus/test";
import type { Account, WorkspaceDoc } from "../src/sync/protocol.ts";
import type { Env } from "./auth.ts";
import {
  deleteRemoteWorkspace,
  getRevisions,
  postRevisions,
  pull,
  putWorkspace,
} from "./workspaces.ts";

const user: Account = { id: "user-1", login: "tester", avatarUrl: null };
const origin = "https://minji.test";
const doc: WorkspaceDoc = {
  title: "Two Sum",
  statement: "Return the sum.",
  notes: "",
  language: "javascript",
  functionName: "sum",
  params: ["a", "b"],
  source: "function sum(a, b) { return a + b; }",
  starterSource: "function sum(a, b) {}",
  testTimeoutMs: 1000,
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
  tests: [
    {
      id: "test-1",
      position: 0,
      label: "small",
      argsText: "[1,2]",
      expectedText: "3",
      compare: { kind: "return" },
    },
  ],
};

const fixture = (): { env: Env; close: () => void } => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync("worker/migrations/0001_init.sql", "utf8"));
  sqlite
    .prepare("INSERT INTO users (id, github_id, login, created_at) VALUES (?, ?, ?, ?)")
    .run(user.id, 123, user.login, Date.now());

  const prepare = (query: string) => {
    const values: SQLInputValue[] = [];
    const statement = {
      bind: (...args: SQLInputValue[]) => {
        values.splice(0, values.length, ...args);
        return statement;
      },
      first: async <T>(): Promise<T | null> =>
        (sqlite.prepare(query).get(...values) as T | undefined) ?? null,
      all: async <T>(): Promise<{ results: T[] }> => ({
        results: sqlite.prepare(query).all(...values) as T[],
      }),
      run: async (): Promise<{ meta: { changes: number } }> => ({
        meta: { changes: Number(sqlite.prepare(query).run(...values).changes) },
      }),
    };
    return statement;
  };
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (cause) {
        sqlite.exec("ROLLBACK");
        throw cause;
      }
    },
  } as unknown as D1Database;
  return {
    env: { DB: db, APP_ORIGIN: origin, GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: "secret" },
    close: () => sqlite.close(),
  };
};

const request = (method: string, path: string, body?: unknown): Request =>
  new Request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

it("uses compare-and-swap revisions and ordered pull sequence numbers", async () => {
  const { env, close } = fixture();
  try {
    const created = await putWorkspace(
      request("PUT", "/api/workspaces/a", { baseRevision: 0, doc }),
      env,
      user,
      "a",
    );
    expect(await created.json()).toMatchObject({ revision: 1, seq: 1 });

    const stale = await putWorkspace(
      request("PUT", "/api/workspaces/a", { baseRevision: 0, doc }),
      env,
      user,
      "a",
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ revision: 1, doc });

    const updated = await putWorkspace(
      request("PUT", "/api/workspaces/a", { baseRevision: 1, doc: { ...doc, title: "Updated" } }),
      env,
      user,
      "a",
    );
    expect(await updated.json()).toMatchObject({ revision: 2, seq: 2 });
    const page = await pull(request("GET", "/api/workspaces?since=1"), env, user);
    expect(await page.json()).toMatchObject({
      cursor: 2,
      more: false,
      items: [{ id: "a", revision: 2, doc: { title: "Updated" } }],
    });

    const deleted = await deleteRemoteWorkspace(
      request("DELETE", "/api/workspaces/a", { baseRevision: 2 }),
      env,
      user,
      "a",
    );
    expect(await deleted.json()).toMatchObject({ revision: 3, seq: 3 });
    const tombstone = await pull(request("GET", "/api/workspaces?since=2"), env, user);
    expect(await tombstone.json()).toMatchObject({
      items: [{ id: "a", deleted: true, doc: null }],
    });
  } finally {
    close();
  }
});

it("inserts revisions idempotently and removes them when a workspace is deleted", async () => {
  const { env, close } = fixture();
  try {
    await putWorkspace(
      request("PUT", "/api/workspaces/a", { baseRevision: 0, doc }),
      env,
      user,
      "a",
    );
    const item = {
      id: "revision-1",
      language: "javascript",
      source: "function sum() {}",
      reason: "save",
      createdAt: doc.createdAt,
    };
    for (const _ of [1, 2]) {
      const result = await postRevisions(
        request("POST", "/api/workspaces/a/revisions", { items: [item] }),
        env,
        user,
        "a",
      );
      expect(result.status).toBe(200);
    }
    const revisions = await getRevisions(env, user, "a");
    expect(await revisions.json()).toMatchObject({ items: [item] });
    await deleteRemoteWorkspace(
      request("DELETE", "/api/workspaces/a", { baseRevision: 1 }),
      env,
      user,
      "a",
    );
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM revisions").first<{ count: number }>())
        ?.count,
    ).toBe(0);
  } finally {
    close();
  }
});
