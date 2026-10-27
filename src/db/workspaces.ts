// Workspace persistence. Every function takes the database so tests can use their own.
import { REVISIONS_PER_WORKSPACE } from "../shared/limits.ts";
import type { Revision, TestCase, Workspace } from "../workspaces/model.ts";
import type { MinjiDatabase } from "./database.ts";

export interface WorkspaceBundle {
  workspace: Workspace;
  tests: TestCase[];
  /** Newest first. */
  revisions: Revision[];
}

const LOCAL_ONLY_STATES = new Set<Workspace["syncState"]>(["local", "excluded"]);

const byWorkspace = (workspaceId: string, low: string | number, high: string | number) =>
  IDBKeyRange.bound([workspaceId, low], [workspaceId, high]);

// Upper bound for string keys in a range.
const HIGHEST_STRING = String.fromCharCode(0xff_ff);

interface DeletableCursor {
  delete(): Promise<void>;
  continue(): Promise<DeletableCursor | null>;
}

const deleteEach = async (opening: Promise<DeletableCursor | null>): Promise<void> => {
  let cursor = await opening;
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
};

/** Stores a new workspace with its tests and revisions in one transaction. */
export const saveNewWorkspace = async (
  db: MinjiDatabase,
  bundle: WorkspaceBundle,
): Promise<void> => {
  const tx = db.transaction(["workspaces", "test_cases", "revisions"], "readwrite");
  const newestRevisions = [...bundle.revisions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, REVISIONS_PER_WORKSPACE);
  await Promise.all([
    tx.objectStore("workspaces").add(bundle.workspace),
    ...bundle.tests.map((test) => tx.objectStore("test_cases").add(test)),
    ...newestRevisions.map((revision) => tx.objectStore("revisions").add(revision)),
    tx.done,
  ]);
};

/** Workspace fields the editor can change. */
export type WorkspaceEdit = Partial<
  Pick<
    Workspace,
    | "title"
    | "statement"
    | "notes"
    | "language"
    | "functionName"
    | "params"
    | "source"
    | "starterSource"
    | "testTimeoutMs"
  >
>;

/** Applies a user edit: bumps updatedAt and marks a synced workspace dirty. */
const touch = (workspace: Workspace, edit: WorkspaceEdit, now: Date): Workspace => ({
  ...workspace,
  ...edit,
  updatedAt: now.toISOString(),
  syncState: workspace.syncState === "synced" ? "dirty" : workspace.syncState,
});

/**
 * Saves an editor draft in one transaction: workspace fields, and the full test list when
 * `tests` is given (tests are replaced, so reorders and deletes need no bookkeeping).
 * Returns the stored workspace, or undefined when it no longer exists.
 */
export const saveDraft = async (
  db: MinjiDatabase,
  id: string,
  edit: WorkspaceEdit,
  tests?: TestCase[],
  now: Date = new Date(),
): Promise<Workspace | undefined> => {
  const tx = db.transaction(["workspaces", "test_cases"], "readwrite");
  const workspaces = tx.objectStore("workspaces");
  const current = await workspaces.get(id);
  if (current === undefined || current.deletedAt !== null) {
    await tx.done;
    return undefined;
  }
  const updated = touch(current, edit, now);
  const writes: Promise<unknown>[] = [workspaces.put(updated)];
  if (tests !== undefined) {
    const store = tx.objectStore("test_cases");
    writes.push(
      (async () => {
        await deleteEach(store.index("workspaceId").openCursor(id));
        await Promise.all(
          tests.map((test, position) => store.put({ ...test, workspaceId: id, position })),
        );
      })(),
    );
  }
  await Promise.all([...writes, tx.done]);
  return updated;
};

/**
 * Adds a revision unless it matches the newest one, then trims to REVISIONS_PER_WORKSPACE.
 * Returns whether a revision was added.
 */
export const addRevision = async (db: MinjiDatabase, revision: Revision): Promise<boolean> => {
  const tx = db.transaction("revisions", "readwrite");
  const index = tx.store.index("workspaceCreatedAt");
  const range = byWorkspace(revision.workspaceId, "", HIGHEST_STRING);
  const newest = await index.openCursor(range, "prev");
  const duplicate =
    newest !== null &&
    newest.value.source === revision.source &&
    newest.value.language === revision.language;
  if (duplicate) {
    await tx.done;
    return false;
  }
  await tx.store.add(revision);
  let cursor = await index.openCursor(range, "prev");
  let kept = 0;
  while (cursor) {
    kept += 1;
    if (kept > REVISIONS_PER_WORKSPACE) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  return true;
};

/** A live workspace, or undefined when it doesn't exist or was deleted. */
export const getWorkspace = async (
  db: MinjiDatabase,
  id: string,
): Promise<Workspace | undefined> => {
  const workspace = await db.get("workspaces", id);
  return workspace?.deletedAt === null ? workspace : undefined;
};

/** Live workspaces, most recently updated first. */
export const listWorkspaces = async (db: MinjiDatabase): Promise<Workspace[]> => {
  const all = await db.getAllFromIndex("workspaces", "updatedAt");
  return all.filter((workspace) => workspace.deletedAt === null).reverse();
};

export const getTestCases = (db: MinjiDatabase, workspaceId: string): Promise<TestCase[]> =>
  db.getAllFromIndex(
    "test_cases",
    "workspacePosition",
    byWorkspace(workspaceId, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
  );

/** Revisions, newest first. */
export const getRevisions = async (db: MinjiDatabase, workspaceId: string): Promise<Revision[]> => {
  const revisions = await db.getAllFromIndex(
    "revisions",
    "workspaceCreatedAt",
    byWorkspace(workspaceId, "", HIGHEST_STRING),
  );
  return revisions.reverse();
};

export const getBundle = async (
  db: MinjiDatabase,
  id: string,
): Promise<WorkspaceBundle | undefined> => {
  const workspace = await getWorkspace(db, id);
  if (workspace === undefined) return undefined;
  const [tests, revisions] = await Promise.all([getTestCases(db, id), getRevisions(db, id)]);
  return { workspace, tests, revisions };
};

/**
 * Deletes a workspace. Local-only workspaces and everything attached to them are removed
 * at once; synced ones become tombstones until the server acknowledges the delete.
 */
export const deleteWorkspace = async (
  db: MinjiDatabase,
  id: string,
  now: Date = new Date(),
): Promise<void> => {
  const tx = db.transaction(
    ["workspaces", "test_cases", "revisions", "runs", "conflicts"],
    "readwrite",
  );
  const workspaces = tx.objectStore("workspaces");
  const workspace = await workspaces.get(id);
  if (workspace === undefined) {
    await tx.done;
    return;
  }

  if (!LOCAL_ONLY_STATES.has(workspace.syncState)) {
    const timestamp = now.toISOString();
    await workspaces.put({
      ...workspace,
      deletedAt: timestamp,
      updatedAt: timestamp,
      syncState: "dirty",
    });
    await tx.done;
    return;
  }

  await Promise.all([
    workspaces.delete(id),
    tx.objectStore("conflicts").delete(id),
    deleteEach(tx.objectStore("test_cases").index("workspaceId").openCursor(id)),
    deleteEach(
      tx
        .objectStore("revisions")
        .index("workspaceCreatedAt")
        .openCursor(byWorkspace(id, "", HIGHEST_STRING)),
    ),
    deleteEach(
      tx
        .objectStore("runs")
        .index("workspaceStartedAt")
        .openCursor(byWorkspace(id, "", HIGHEST_STRING)),
    ),
  ]);
  await tx.done;
};

export const getMeta = async <T>(db: MinjiDatabase, key: string): Promise<T | undefined> =>
  (await db.get("meta", key))?.value as T | undefined;

export const setMeta = async (db: MinjiDatabase, key: string, value: unknown): Promise<void> => {
  await db.put("meta", { key, value });
};
