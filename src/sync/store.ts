import type { MinjiDatabase, ConflictRecord } from "../db/database.ts";
import { REVISIONS_PER_WORKSPACE } from "../shared/limits.ts";
import {
  getBundle,
  getMeta,
  getRevisions,
  getTestCases,
  setMeta,
  type WorkspaceBundle,
} from "../db/workspaces.ts";
import { newId } from "../shared/ids.ts";
import type { SyncItem, WorkspaceDoc, RevisionDto } from "./protocol.ts";
import type { Revision, TestCase, Workspace } from "../workspaces/model.ts";

const FULL_RESYNC_AGE_MS = 80 * 24 * 60 * 60 * 1000;
const oldest = "";
const newest = String.fromCharCode(0xff_ff);
const byWorkspace = (id: string) => IDBKeyRange.bound([id, oldest], [id, newest]);

export const hasOpenEditor = async (id: string): Promise<boolean> =>
  typeof navigator !== "undefined" && navigator.locks !== undefined
    ? navigator.locks.request(`workspace:${id}`, { ifAvailable: true }, (lock) => lock === null)
    : false;

export const currentUserId = async (db: MinjiDatabase): Promise<string | undefined> => {
  const value = await getMeta<unknown>(db, "currentUserId");
  return typeof value === "string" ? value : undefined;
};
export const setCurrentUser = async (db: MinjiDatabase, id: string): Promise<void> => {
  const previous = await currentUserId(db);
  if (previous !== id) {
    await setMeta(db, "syncCursor", 0);
    await setMeta(db, "lastPullAt", 0);
  }
  await setMeta(db, "currentUserId", id);
};
export const clearCurrentUser = async (db: MinjiDatabase): Promise<void> => {
  await setMeta(db, "currentUserId", null);
  await setMeta(db, "syncCursor", 0);
  await setMeta(db, "lastPullAt", 0);
};
export const readCursor = async (db: MinjiDatabase): Promise<number> => {
  const lastPull = (await getMeta<number>(db, "lastPullAt")) ?? 0;
  return Date.now() - lastPull > FULL_RESYNC_AGE_MS
    ? 0
    : ((await getMeta<number>(db, "syncCursor")) ?? 0);
};
export const saveCursor = async (db: MinjiDatabase, cursor: number): Promise<void> => {
  await setMeta(db, "syncCursor", cursor);
  await setMeta(db, "lastPullAt", Date.now());
};

export const pendingLocalWorkspaces = async (db: MinjiDatabase): Promise<Workspace[]> =>
  (await db.getAll("workspaces")).filter(
    (workspace) =>
      workspace.ownerId === null && workspace.syncState === "local" && workspace.deletedAt === null,
  );

export const chooseLocalWorkspaces = async (
  db: MinjiDatabase,
  userId: string,
  upload: boolean,
): Promise<void> => {
  const tx = db.transaction("workspaces", "readwrite");
  const all = await tx.store.getAll();
  for (const workspace of all) {
    if (
      workspace.ownerId !== null ||
      workspace.syncState !== "local" ||
      workspace.deletedAt !== null
    )
      continue;
    await tx.store.put({
      ...workspace,
      ownerId: upload ? userId : null,
      syncState: upload ? "dirty" : "excluded",
    });
  }
  await tx.done;
};

export const startSyncingWorkspace = async (
  db: MinjiDatabase,
  id: string,
  userId: string,
): Promise<void> => {
  const tx = db.transaction("workspaces", "readwrite");
  const workspace = await tx.store.get(id);
  if (workspace?.syncState === "excluded")
    await tx.store.put({ ...workspace, ownerId: userId, syncState: "dirty" });
  await tx.done;
};

export const copyToAccount = async (
  db: MinjiDatabase,
  id: string,
  userId: string,
): Promise<string | undefined> => {
  const bundle = await getBundle(db, id);
  if (bundle === undefined) return undefined;
  const nextId = newId();
  const now = new Date().toISOString();
  const tx = db.transaction(["workspaces", "test_cases", "revisions"], "readwrite");
  await tx.objectStore("workspaces").add({
    ...bundle.workspace,
    id: nextId,
    title: `${bundle.workspace.title} (copy)`,
    createdAt: now,
    updatedAt: now,
    ownerId: userId,
    syncRevision: 0,
    syncState: "dirty",
    deletedAt: null,
    lastRun: null,
  });
  for (const test of bundle.tests)
    await tx.objectStore("test_cases").add({ ...test, id: newId(), workspaceId: nextId });
  for (const revision of bundle.revisions)
    await tx
      .objectStore("revisions")
      .add({ ...revision, id: newId(), workspaceId: nextId, synced: false });
  await tx.done;
  return nextId;
};

export const dirtyBundles = async (
  db: MinjiDatabase,
  userId: string,
): Promise<WorkspaceBundle[]> => {
  const dirty = await db.getAllFromIndex("workspaces", "syncState", "dirty");
  const owned = dirty.filter((workspace) => workspace.ownerId === userId);
  return Promise.all(
    owned.map(async (workspace) => ({
      workspace,
      tests: await getTestCases(db, workspace.id),
      revisions: await getRevisions(db, workspace.id),
    })),
  );
};

export const markTooLarge = async (db: MinjiDatabase, id: string): Promise<void> => {
  const tx = db.transaction("workspaces", "readwrite");
  const workspace = await tx.store.get(id);
  if (workspace?.syncState === "dirty")
    await tx.store.put({ ...workspace, syncState: "too-large" });
  await tx.done;
};

export const purgeWorkspace = async (db: MinjiDatabase, id: string): Promise<void> => {
  const tx = db.transaction(
    ["workspaces", "test_cases", "revisions", "runs", "conflicts"],
    "readwrite",
  );
  await tx.objectStore("workspaces").delete(id);
  await tx.objectStore("conflicts").delete(id);
  const tests = await tx.objectStore("test_cases").index("workspaceId").getAll(id);
  for (const test of tests) await tx.objectStore("test_cases").delete(test.id);
  const revisions = await tx
    .objectStore("revisions")
    .index("workspaceCreatedAt")
    .getAll(byWorkspace(id));
  for (const revision of revisions) await tx.objectStore("revisions").delete(revision.id);
  const runs = await tx.objectStore("runs").index("workspaceStartedAt").getAll(byWorkspace(id));
  for (const run of runs) await tx.objectStore("runs").delete(run.id);
  await tx.done;
};

export const acceptPush = async (
  db: MinjiDatabase,
  snapshot: Workspace,
  revision: number,
): Promise<void> => {
  const tx = db.transaction("workspaces", "readwrite");
  const current = await tx.store.get(snapshot.id);
  if (current !== undefined) {
    await tx.store.put({
      ...current,
      syncRevision: revision,
      syncState: current.updatedAt === snapshot.updatedAt ? "synced" : "dirty",
    });
  }
  await tx.done;
};

const testsFromDoc = (id: string, doc: WorkspaceDoc): TestCase[] =>
  doc.tests.map((test) => ({ ...test, workspaceId: id }));

export const applyRemote = async (
  db: MinjiDatabase,
  userId: string,
  item: SyncItem,
): Promise<"ignored" | "updated" | "deleted" | "conflict"> => {
  // The practice editor holds this lock for its lifetime. Its latest keystrokes
  // can still be waiting in the autosave timer, so preserve that editor state
  // when a newer remote version arrives.
  const editorOpen = await hasOpenEditor(item.id);
  const tx = db.transaction(["workspaces", "test_cases", "conflicts"], "readwrite");
  const workspaceStore = tx.objectStore("workspaces");
  const local = await workspaceStore.get(item.id);
  if (local?.ownerId !== undefined && local.ownerId !== null && local.ownerId !== userId) {
    await tx.done;
    return "ignored";
  }
  if (local !== undefined && item.revision <= local.syncRevision) {
    await tx.done;
    return "ignored";
  }
  if (
    local !== undefined &&
    (local.syncState === "dirty" ||
      local.syncState === "conflict" ||
      local.syncState === "too-large" ||
      editorOpen)
  ) {
    await workspaceStore.put({ ...local, syncState: "conflict" });
    await tx.objectStore("conflicts").put({
      workspaceId: item.id,
      remoteRevision: item.revision,
      deleted: item.deleted,
      doc: item.doc,
    });
    await tx.done;
    return "conflict";
  }
  if (item.deleted || item.doc === null) {
    await tx.done;
    if (local !== undefined) await purgeWorkspace(db, item.id);
    return "deleted";
  }
  const doc = item.doc;
  const workspace: Workspace = {
    id: item.id,
    title: doc.title,
    statement: doc.statement,
    notes: doc.notes,
    folder: doc.folder ?? "",
    tags: doc.tags ?? [],
    language: doc.language,
    functionName: doc.functionName,
    params: doc.params,
    source: doc.source,
    starterSource: doc.starterSource,
    testTimeoutMs: doc.testTimeoutMs,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    deletedAt: null,
    ownerId: userId,
    syncRevision: item.revision,
    syncState: "synced",
    lastRun: local?.lastRun ?? null,
  };
  await workspaceStore.put(workspace);
  const tests = tx.objectStore("test_cases");
  const previous = await tests.index("workspaceId").getAll(item.id);
  for (const test of previous) await tests.delete(test.id);
  for (const test of testsFromDoc(item.id, doc)) await tests.put(test);
  await tx.done;
  return "updated";
};

export const saveConflict = async (db: MinjiDatabase, item: SyncItem): Promise<void> => {
  const tx = db.transaction(["workspaces", "conflicts"], "readwrite");
  const local = await tx.objectStore("workspaces").get(item.id);
  if (local !== undefined) {
    await tx.objectStore("workspaces").put({ ...local, syncState: "conflict" });
    await tx.objectStore("conflicts").put({
      workspaceId: item.id,
      remoteRevision: item.revision,
      deleted: item.deleted,
      doc: item.doc,
    });
  }
  await tx.done;
};

export const getConflict = (db: MinjiDatabase, id: string): Promise<ConflictRecord | undefined> =>
  db.get("conflicts", id);

export const keepTheirs = async (db: MinjiDatabase, id: string, userId: string): Promise<void> => {
  const conflict = await getConflict(db, id);
  const local = await getBundle(db, id);
  if (conflict === undefined || local === undefined) return;
  const now = new Date().toISOString();
  await db.put("revisions", {
    id: newId(),
    workspaceId: id,
    language: local.workspace.language,
    source: local.workspace.source,
    reason: "save",
    createdAt: now,
    synced: false,
  });
  await db.delete("conflicts", id);
  await db.put("workspaces", {
    ...local.workspace,
    syncState: "synced",
    syncRevision: conflict.remoteRevision - 1,
  });
  if (conflict.deleted || conflict.doc === null) {
    await purgeWorkspace(db, id);
    return;
  }
  await applyRemote(db, userId, {
    id,
    revision: conflict.remoteRevision,
    seq: 0,
    deleted: false,
    doc: conflict.doc as WorkspaceDoc,
  });
};

export const keepBoth = async (
  db: MinjiDatabase,
  id: string,
  userId: string,
): Promise<string | undefined> => {
  const copyId = await copyToAccount(db, id, userId);
  await keepTheirs(db, id, userId);
  return copyId;
};

export const prepareKeepMine = async (
  db: MinjiDatabase,
  id: string,
  userId: string,
): Promise<{ id: string; baseRevision: number } | undefined> => {
  const conflict = await getConflict(db, id);
  const local = await db.get("workspaces", id);
  if (conflict === undefined || local === undefined) return undefined;
  if (conflict.deleted) {
    const copyId = await copyToAccount(db, id, userId);
    await purgeWorkspace(db, id);
    return copyId === undefined ? undefined : { id: copyId, baseRevision: 0 };
  }
  await db.delete("conflicts", id);
  await db.put("workspaces", {
    ...local,
    syncRevision: conflict.remoteRevision,
    syncState: "dirty",
  });
  return { id, baseRevision: conflict.remoteRevision };
};

export const mergeRevisions = async (
  db: MinjiDatabase,
  id: string,
  items: RevisionDto[],
): Promise<void> => {
  const existing = new Set((await getRevisions(db, id)).map((revision) => revision.id));
  const tx = db.transaction("revisions", "readwrite");
  for (const item of items) {
    if (existing.has(item.id)) continue;
    const revision: Revision = { ...item, workspaceId: id, synced: true };
    await tx.store.put(revision);
  }
  let cursor = await tx.store.index("workspaceCreatedAt").openCursor(byWorkspace(id), "prev");
  let kept = 0;
  while (cursor !== null) {
    if (kept >= REVISIONS_PER_WORKSPACE && cursor.value.synced) await cursor.delete();
    else kept += 1;
    cursor = await cursor.continue();
  }
  await tx.done;
};

export const unsyncedRevisions = async (db: MinjiDatabase, id: string): Promise<Revision[]> =>
  (await getRevisions(db, id)).filter((revision) => !revision.synced);

export const markRevisionsSynced = async (db: MinjiDatabase, ids: string[]): Promise<void> => {
  const tx = db.transaction("revisions", "readwrite");
  for (const id of ids) {
    const revision = await tx.store.get(id);
    if (revision !== undefined) await tx.store.put({ ...revision, synced: true });
  }
  await tx.done;
};
