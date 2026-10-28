import type { MinjiDatabase } from "../db/database.ts";
import { listWorkspaces } from "../db/workspaces.ts";
import { postChannelMessage } from "../shared/channel.ts";
import { MAX_SYNC_DOC_BYTES } from "../shared/limits.ts";
import {
  ApiFailure,
  deleteWorkspace,
  pullChanges,
  pullRevisions,
  pushRevisions,
  pushWorkspace,
} from "./api.ts";
import { workspaceDoc, type SyncItem } from "./protocol.ts";
import {
  acceptPush,
  applyRemote,
  dirtyBundles,
  hasOpenEditor,
  markRevisionsSynced,
  markTooLarge,
  mergeRevisions,
  purgeWorkspace,
  readCursor,
  saveConflict,
  saveCursor,
  unsyncedRevisions,
} from "./store.ts";

export type SyncStatus = "idle" | "syncing" | "retrying" | "signed-out";

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const conflictItem = (id: string, failure: ApiFailure): SyncItem => ({
  id,
  revision: failure.body.revision ?? 0,
  seq: 0,
  deleted: failure.body.deleted ?? false,
  doc: failure.body.doc ?? null,
});

const pull = async (db: MinjiDatabase, userId: string): Promise<void> => {
  let cursor = await readCursor(db);
  const full = cursor === 0;
  const seen = new Set<string>();
  let more = true;
  while (more) {
    const page = await pullChanges(cursor);
    if (page.cursor < cursor) throw new Error("Sync cursor moved backwards");
    for (const item of page.items) {
      seen.add(item.id);
      const result = await applyRemote(db, userId, item);
      if (result !== "ignored") postChannelMessage({ type: "changed", id: item.id });
    }
    cursor = page.cursor;
    more = page.more;
    await saveCursor(db, cursor);
  }
  if (full) {
    const local = await listWorkspaces(db);
    for (const workspace of local) {
      if (
        workspace.ownerId === userId &&
        workspace.syncState === "synced" &&
        !seen.has(workspace.id) &&
        !(await hasOpenEditor(workspace.id))
      ) {
        await purgeWorkspace(db, workspace.id);
        postChannelMessage({ type: "changed", id: workspace.id });
      }
    }
  }
};

const push = async (db: MinjiDatabase, userId: string): Promise<void> => {
  const bundles = await dirtyBundles(db, userId);
  for (const { workspace, tests } of bundles) {
    try {
      if (workspace.deletedAt !== null) {
        await deleteWorkspace(workspace.id, workspace.syncRevision);
        await purgeWorkspace(db, workspace.id);
        postChannelMessage({ type: "changed", id: workspace.id });
        continue;
      }
      const doc = workspaceDoc(workspace, tests);
      if (bytes(doc) > MAX_SYNC_DOC_BYTES) {
        await markTooLarge(db, workspace.id);
        postChannelMessage({ type: "changed", id: workspace.id });
        continue;
      }
      const answer = await pushWorkspace(workspace.id, workspace.syncRevision, doc);
      await acceptPush(db, workspace, answer.revision);
      const revisions = await unsyncedRevisions(db, workspace.id);
      if (revisions.length > 0) {
        const accepted = await pushRevisions(
          workspace.id,
          revisions.map(({ id, language, source, reason, createdAt }) => ({
            id,
            language,
            source,
            reason,
            createdAt,
          })),
        );
        await markRevisionsSynced(db, accepted.accepted);
      }
      postChannelMessage({ type: "changed", id: workspace.id });
    } catch (cause) {
      if (cause instanceof ApiFailure && cause.status === 409) {
        await saveConflict(db, conflictItem(workspace.id, cause));
        postChannelMessage({ type: "changed", id: workspace.id });
        continue;
      }
      if (cause instanceof ApiFailure && cause.status === 413) {
        await markTooLarge(db, workspace.id);
        postChannelMessage({ type: "changed", id: workspace.id });
        continue;
      }
      throw cause;
    }
  }
  const synced = (await listWorkspaces(db)).filter(
    (workspace) => workspace.ownerId === userId && workspace.syncState === "synced",
  );
  for (const workspace of synced) {
    const revisions = await unsyncedRevisions(db, workspace.id);
    if (revisions.length === 0) continue;
    const accepted = await pushRevisions(
      workspace.id,
      revisions.map(({ id, language, source, reason, createdAt }) => ({
        id,
        language,
        source,
        reason,
        createdAt,
      })),
    );
    await markRevisionsSynced(db, accepted.accepted);
  }
  // A revision can be added after a run without changing the workspace document.
  // Fetch histories for all synced workspaces so another device receives it.
  for (const workspace of synced) {
    const remote = await pullRevisions(workspace.id);
    await mergeRevisions(db, workspace.id, remote.items);
  }
};

/** One sync cycle. The Web Lock serializes work across tabs. */
export const syncNow = async (
  db: MinjiDatabase,
  userId: string,
  onStatus: (status: SyncStatus) => void,
): Promise<void> => {
  const work = async (): Promise<void> => {
    onStatus("syncing");
    await pull(db, userId);
    await push(db, userId);
    onStatus("idle");
  };
  if (navigator.locks === undefined) {
    await work();
    return;
  }
  await navigator.locks.request("sync", { ifAvailable: true }, async (lock) => {
    if (lock === null) {
      postChannelMessage({ type: "sync-request" });
      return;
    }
    await work();
  });
};
