import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vite-plus/test";
import { REVISIONS_PER_WORKSPACE, RUNS_PER_WORKSPACE } from "../shared/limits.ts";
import {
  createWorkspace,
  type Revision,
  type TestCase,
  type Workspace,
} from "../workspaces/model.ts";
import { openMinjiDatabase, type MinjiDatabase } from "./database.ts";
import {
  addRevision,
  addRun,
  deleteWorkspace,
  getBundle,
  getMeta,
  getRuns,
  getWorkspace,
  listWorkspaces,
  saveDraft,
  saveNewWorkspace,
  setLastRun,
  setMeta,
} from "./workspaces.ts";

let db: MinjiDatabase;
let databaseCount = 0;

beforeEach(async () => {
  databaseCount += 1;
  db = await openMinjiDatabase(`test-${databaseCount}`);
});

const at = (iso: string): Date => new Date(iso);

const testCase = (workspace: Workspace, position: number): TestCase => ({
  id: `${workspace.id}-t${position}`,
  workspaceId: workspace.id,
  position,
  label: "",
  argsText: `[${position}]`,
  expectedText: "0",
  compare: { kind: "return" },
});

const revision = (workspace: Workspace, day: number): Revision => ({
  id: `${workspace.id}-r${day}`,
  workspaceId: workspace.id,
  language: "typescript",
  source: `v${day}`,
  reason: "save",
  createdAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  synced: false,
});

it("saves a workspace with tests in position order and newest revisions first", async () => {
  const workspace = createWorkspace({ title: "A" });
  await saveNewWorkspace(db, {
    workspace,
    tests: [testCase(workspace, 1), testCase(workspace, 0)],
    revisions: [revision(workspace, 1), revision(workspace, 3), revision(workspace, 2)],
  });
  const bundle = await getBundle(db, workspace.id);
  expect(bundle?.workspace).toEqual(workspace);
  expect(bundle?.tests.map((test) => test.position)).toEqual([0, 1]);
  expect(bundle?.revisions.map((entry) => entry.source)).toEqual(["v3", "v2", "v1"]);
});

it("keeps only the newest revisions", async () => {
  const workspace = createWorkspace({});
  const revisions = Array.from({ length: REVISIONS_PER_WORKSPACE + 5 }, (_, index) =>
    revision(workspace, index + 1),
  );
  await saveNewWorkspace(db, { workspace, tests: [], revisions });
  const bundle = await getBundle(db, workspace.id);
  expect(bundle?.revisions).toHaveLength(REVISIONS_PER_WORKSPACE);
  expect(bundle?.revisions.at(-1)?.source).toBe("v6");
});

it("lists live workspaces, most recently updated first", async () => {
  const older = createWorkspace({ title: "older" }, at("2026-10-01T00:00:00Z"));
  const newer = createWorkspace({ title: "newer" }, at("2026-10-02T00:00:00Z"));
  await saveNewWorkspace(db, { workspace: older, tests: [], revisions: [] });
  await saveNewWorkspace(db, { workspace: newer, tests: [], revisions: [] });
  expect((await listWorkspaces(db)).map((workspace) => workspace.title)).toEqual([
    "newer",
    "older",
  ]);
});

it("removes a local workspace and everything attached to it", async () => {
  const workspace = createWorkspace({});
  const other = createWorkspace({});
  await saveNewWorkspace(db, {
    workspace,
    tests: [testCase(workspace, 0)],
    revisions: [revision(workspace, 1)],
  });
  await saveNewWorkspace(db, {
    workspace: other,
    tests: [testCase(other, 0)],
    revisions: [revision(other, 1)],
  });

  await deleteWorkspace(db, workspace.id);

  expect(await db.get("workspaces", workspace.id)).toBeUndefined();
  expect(await db.count("test_cases")).toBe(1);
  expect(await db.count("revisions")).toBe(1);
  expect((await getBundle(db, other.id))?.tests).toHaveLength(1);
});

it("tombstones a synced workspace instead of removing it", async () => {
  const workspace = { ...createWorkspace({}), syncState: "synced" as const, syncRevision: 3 };
  await saveNewWorkspace(db, { workspace, tests: [testCase(workspace, 0)], revisions: [] });

  await deleteWorkspace(db, workspace.id, at("2026-10-27T12:00:00Z"));

  expect(await getWorkspace(db, workspace.id)).toBeUndefined();
  expect(await listWorkspaces(db)).toEqual([]);
  expect(await db.get("workspaces", workspace.id)).toMatchObject({
    deletedAt: "2026-10-27T12:00:00.000Z",
    syncState: "dirty",
  });
  expect(await db.count("test_cases")).toBe(1);
});

it("stores meta values", async () => {
  expect(await getMeta(db, "persistRequested")).toBeUndefined();
  await setMeta(db, "persistRequested", true);
  expect(await getMeta<boolean>(db, "persistRequested")).toBe(true);
});

it("saves a draft, replacing the tests and marking synced workspaces dirty", async () => {
  const workspace = { ...createWorkspace({ title: "A" }), syncState: "synced" as const };
  await saveNewWorkspace(db, {
    workspace,
    tests: [testCase(workspace, 0), testCase(workspace, 1)],
    revisions: [],
  });
  const [first, second] = (await getBundle(db, workspace.id))?.tests ?? [];
  if (first === undefined || second === undefined) throw new Error("missing tests");

  const saved = await saveDraft(
    db,
    workspace.id,
    { title: "B", source: "x" },
    [second, { ...first, label: "moved" }],
    at("2026-10-27T12:00:00Z"),
  );

  expect(saved).toMatchObject({ title: "B", source: "x", syncState: "dirty" });
  const bundle = await getBundle(db, workspace.id);
  expect(bundle?.workspace.updatedAt).toBe("2026-10-27T12:00:00.000Z");
  expect(bundle?.tests.map((entry) => [entry.id, entry.position, entry.label])).toEqual([
    [second.id, 0, ""],
    [first.id, 1, "moved"],
  ]);
});

it("leaves tests alone when a draft has none", async () => {
  const workspace = createWorkspace({});
  await saveNewWorkspace(db, { workspace, tests: [testCase(workspace, 0)], revisions: [] });
  await saveDraft(db, workspace.id, { notes: "n" });
  expect((await getBundle(db, workspace.id))?.tests).toHaveLength(1);
  expect(await saveDraft(db, "missing", { notes: "n" })).toBeUndefined();
});

it("adds revisions, skipping duplicates of the newest and trimming old ones", async () => {
  const workspace = createWorkspace({});
  await saveNewWorkspace(db, { workspace, tests: [], revisions: [] });
  const first = revision(workspace, 1);
  expect(await addRevision(db, first)).toEqual({ added: true, id: first.id });
  expect(await addRevision(db, { ...revision(workspace, 2), source: "v1" })).toEqual({
    added: false,
    id: first.id,
  });
  for (let day = 2; day <= REVISIONS_PER_WORKSPACE + 3; day += 1) {
    await addRevision(db, revision(workspace, day));
  }
  const revisions = (await getBundle(db, workspace.id))?.revisions ?? [];
  expect(revisions).toHaveLength(REVISIONS_PER_WORKSPACE);
  expect(revisions[0]?.source).toBe(`v${REVISIONS_PER_WORKSPACE + 3}`);
});

it("stores runs, keeping the newest, and records the last run without touching updatedAt", async () => {
  const workspace = createWorkspace({}, at("2026-10-01T00:00:00Z"));
  await saveNewWorkspace(db, { workspace, tests: [], revisions: [] });
  for (let day = 1; day <= RUNS_PER_WORKSPACE + 2; day += 1) {
    await addRun(db, {
      id: `run-${day}`,
      workspaceId: workspace.id,
      scope: "all",
      startedAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`,
      durationMs: 5,
      revisionId: null,
      outcome: "completed",
      message: null,
      results: [],
    });
  }
  const runs = await getRuns(db, workspace.id);
  expect(runs).toHaveLength(RUNS_PER_WORKSPACE);
  expect(runs[0]?.id).toBe(`run-${RUNS_PER_WORKSPACE + 2}`);

  await setLastRun(db, workspace.id, { passed: 2, total: 3, at: "2026-10-27T00:00:00.000Z" });
  expect(await getWorkspace(db, workspace.id)).toMatchObject({
    lastRun: { passed: 2, total: 3 },
    updatedAt: workspace.updatedAt,
    syncState: "local",
  });
});
