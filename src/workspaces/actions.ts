// Workspace operations used by more than one screen.
import type { MinjiDatabase } from "../db/database.ts";
import {
  getBundle,
  getMeta,
  listWorkspaces,
  saveNewWorkspace,
  setMeta,
  type WorkspaceBundle,
} from "../db/workspaces.ts";
import { exportFileName, toExportFile } from "../import/exportFormat.ts";
import type { Language } from "../runner/types.ts";
import { downloadText } from "../shared/download.ts";
import { createWorkspace } from "./model.ts";

const LAST_LANGUAGE_KEY = "minji:lastLanguage";

export const readLastLanguage = (): Language | undefined => {
  try {
    const stored = localStorage.getItem(LAST_LANGUAGE_KEY);
    return stored === "javascript" || stored === "typescript" ? stored : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Asks the browser not to evict our storage, once, after the first saved workspace.
 * Records the answer so the home screen can warn when it was refused.
 */
export const requestPersistentStorage = async (db: MinjiDatabase): Promise<void> => {
  if ((await getMeta<boolean>(db, "persistRequested")) === true) return;
  const granted = (await navigator.storage?.persist?.()) ?? false;
  await setMeta(db, "persistRequested", true);
  await setMeta(db, "persistGranted", granted);
};

export const isStoragePersistent = async (db: MinjiDatabase): Promise<boolean | undefined> => {
  const persisted = await navigator.storage?.persisted?.();
  return persisted ?? (await getMeta<boolean>(db, "persistGranted"));
};

/** Creates a scratch workspace and returns its id. */
export const createScratchWorkspace = async (db: MinjiDatabase): Promise<string> => {
  const workspace = createWorkspace({ language: readLastLanguage() });
  await saveNewWorkspace(db, { workspace, tests: [], revisions: [] });
  await requestPersistentStorage(db);
  return workspace.id;
};

export const saveImportedWorkspaces = async (
  db: MinjiDatabase,
  bundles: WorkspaceBundle[],
): Promise<void> => {
  for (const bundle of bundles) {
    await saveNewWorkspace(db, bundle);
  }
  if (bundles.length > 0) await requestPersistentStorage(db);
};

/** Downloads the given workspaces, or every workspace when `ids` is omitted. */
export const exportWorkspaces = async (db: MinjiDatabase, ids?: string[]): Promise<void> => {
  const wanted = ids ?? (await listWorkspaces(db)).map((workspace) => workspace.id);
  const bundles = (await Promise.all(wanted.map((id) => getBundle(db, id)))).filter(
    (bundle): bundle is WorkspaceBundle => bundle !== undefined,
  );
  if (bundles.length === 0) return;
  const file = toExportFile(bundles);
  const name = exportFileName(
    ids === undefined ? [] : bundles.map(({ workspace }) => workspace.title),
  );
  downloadText(name, `${JSON.stringify(file, null, 2)}\n`);
};
