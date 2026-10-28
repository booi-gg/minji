import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { openMinjiDatabase, type MinjiDatabase } from "../db/database.ts";
import { getRevisions, getTestCases, saveNewWorkspace } from "../db/workspaces.ts";
import { REVISIONS_PER_WORKSPACE } from "../shared/limits.ts";
import { createWorkspace } from "../workspaces/model.ts";
import { workspaceDoc, type SyncItem } from "./protocol.ts";
import {
  applyRemote,
  chooseLocalWorkspaces,
  currentUserId,
  getConflict,
  keepBoth,
  mergeRevisions,
  prepareKeepMine,
  setCurrentUser,
} from "./store.ts";

let db: MinjiDatabase;
let serial = 0;
beforeEach(async () => {
  serial += 1;
  db = await openMinjiDatabase(`sync-test-${serial}`);
});

const item = (revision: number, source: string): SyncItem => {
  const workspace = createWorkspace({ title: "Remote", source });
  return {
    id: "workspace-1",
    revision,
    seq: revision,
    deleted: false,
    doc: workspaceDoc(workspace, [
      {
        id: "test-1",
        workspaceId: "workspace-1",
        position: 0,
        label: "example",
        argsText: "[1]",
        expectedText: "1",
        compare: { kind: "return" },
      },
    ]),
  };
};

it("keeps local workspaces on the device when upload is declined", async () => {
  const workspace = createWorkspace({ title: "Mine" });
  await saveNewWorkspace(db, { workspace, tests: [], revisions: [] });
  await setCurrentUser(db, "user-1");
  await chooseLocalWorkspaces(db, "user-1", false);
  expect(await currentUserId(db)).toBe("user-1");
  expect(await db.get("workspaces", workspace.id)).toMatchObject({
    ownerId: null,
    syncState: "excluded",
  });
});

it("keeps advanced test settings when pulling a workspace", async () => {
  const remote = item(1, "class Counter {}");
  if (remote.doc === null) throw new Error("Missing remote document");
  remote.doc.tests[0] = {
    ...remote.doc.tests[0],
    kind: "class",
    inputAdapters: [],
    outputAdapter: "plain",
    comparison: { tolerance: 0.01, unordered: false },
  };
  remote.doc.folder = "Graphs";
  remote.doc.tags = ["BFS"];
  expect(await applyRemote(db, "user-1", remote)).toBe("updated");
  expect((await getTestCases(db, "workspace-1"))[0]).toMatchObject({
    kind: "class",
    comparison: { tolerance: 0.01, unordered: false },
  });
  expect(await db.get("workspaces", "workspace-1")).toMatchObject({
    folder: "Graphs",
    tags: ["BFS"],
  });
});

it("stores a remote edit as a conflict without replacing local code or tests", async () => {
  expect(await applyRemote(db, "user-1", item(1, "server one"))).toBe("updated");
  const local = await db.get("workspaces", "workspace-1");
  expect(local?.source).toBe("server one");
  await db.put("workspaces", { ...local!, source: "my unsynced code", syncState: "dirty" });
  const newer = item(2, "server two");
  expect(await applyRemote(db, "user-1", newer)).toBe("conflict");
  expect((await db.get("workspaces", "workspace-1"))?.source).toBe("my unsynced code");
  expect(await getConflict(db, "workspace-1")).toMatchObject({ remoteRevision: 2 });
  expect(await getTestCases(db, "workspace-1")).toHaveLength(1);

  const copyId = await keepBoth(db, "workspace-1", "user-1");
  expect(copyId).toBeDefined();
  expect((await db.get("workspaces", copyId!))?.source).toBe("my unsynced code");
  expect((await db.get("workspaces", "workspace-1"))?.source).toBe("server two");
});

it("preserves an open editor's pending text when a remote edit arrives", async () => {
  await applyRemote(db, "user-1", item(1, "server one"));
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: null) => boolean,
      ): Promise<boolean> => callback(null),
    },
  });
  try {
    expect(await applyRemote(db, "user-1", item(2, "server two"))).toBe("conflict");
    expect((await db.get("workspaces", "workspace-1"))?.source).toBe("server one");
    expect(await getConflict(db, "workspace-1")).toMatchObject({ remoteRevision: 2 });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps a local copy when a remote tombstone wins", async () => {
  await applyRemote(db, "user-1", item(1, "server"));
  const local = await db.get("workspaces", "workspace-1");
  await db.put("workspaces", { ...local!, source: "mine", syncState: "dirty" });
  await applyRemote(db, "user-1", {
    id: "workspace-1",
    revision: 2,
    seq: 2,
    deleted: true,
    doc: null,
  });
  const kept = await prepareKeepMine(db, "workspace-1", "user-1");
  expect(kept?.baseRevision).toBe(0);
  expect(await db.get("workspaces", "workspace-1")).toBeUndefined();
  expect((await db.get("workspaces", kept!.id))?.source).toBe("mine");
});

it("keeps only the newest synced revisions after merging another device's history", async () => {
  await applyRemote(db, "user-1", item(1, "server"));
  for (let index = 1; index <= 15; index += 1) {
    await db.put("revisions", {
      id: `old-${index}`,
      workspaceId: "workspace-1",
      language: "javascript",
      source: `old ${index}`,
      reason: "save",
      createdAt: `2026-09-${String(index).padStart(2, "0")}T00:00:00.000Z`,
      synced: true,
    });
  }
  const remote = Array.from({ length: 20 }, (_, index) => ({
    id: `new-${index}`,
    language: "javascript" as const,
    source: `new ${index}`,
    reason: "save" as const,
    createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  await mergeRevisions(db, "workspace-1", remote);
  const revisions = await getRevisions(db, "workspace-1");
  expect(revisions).toHaveLength(REVISIONS_PER_WORKSPACE);
  expect(revisions.every((revision) => revision.id.startsWith("new-"))).toBe(true);
});
