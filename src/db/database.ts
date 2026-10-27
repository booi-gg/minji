// IndexedDB layout from specs/data-model.md, opened through `idb`.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { RunRecord, Revision, SyncState, TestCase, Workspace } from "../workspaces/model.ts";

export interface ConflictRecord {
  workspaceId: string;
  remoteRevision: number;
  deleted: boolean;
  doc: unknown;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface MinjiSchema extends DBSchema {
  workspaces: {
    key: string;
    value: Workspace;
    indexes: { updatedAt: string; syncState: SyncState };
  };
  test_cases: {
    key: string;
    value: TestCase;
    indexes: { workspaceId: string; workspacePosition: [string, number] };
  };
  revisions: {
    key: string;
    value: Revision;
    indexes: { workspaceCreatedAt: [string, string] };
  };
  runs: {
    key: string;
    value: RunRecord;
    indexes: { workspaceStartedAt: [string, string] };
  };
  conflicts: {
    key: string;
    value: ConflictRecord;
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

export type MinjiDatabase = IDBPDatabase<MinjiSchema>;

export const DATABASE_NAME = "minji";
const DATABASE_VERSION = 1;

export const openMinjiDatabase = (name: string = DATABASE_NAME): Promise<MinjiDatabase> =>
  openDB<MinjiSchema>(name, DATABASE_VERSION, {
    upgrade(db, oldVersion) {
      // Never edit version 1 after release; add a new `if (oldVersion < 2)` block instead.
      if (oldVersion < 1) {
        const workspaces = db.createObjectStore("workspaces", { keyPath: "id" });
        workspaces.createIndex("updatedAt", "updatedAt");
        workspaces.createIndex("syncState", "syncState");

        const tests = db.createObjectStore("test_cases", { keyPath: "id" });
        tests.createIndex("workspaceId", "workspaceId");
        tests.createIndex("workspacePosition", ["workspaceId", "position"]);

        const revisions = db.createObjectStore("revisions", { keyPath: "id" });
        revisions.createIndex("workspaceCreatedAt", ["workspaceId", "createdAt"]);

        const runs = db.createObjectStore("runs", { keyPath: "id" });
        runs.createIndex("workspaceStartedAt", ["workspaceId", "startedAt"]);

        db.createObjectStore("conflicts", { keyPath: "workspaceId" });
        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });

let shared: Promise<MinjiDatabase> | undefined;

/** The app's database connection, opened on first use. */
export const getDatabase = (): Promise<MinjiDatabase> => {
  shared ??= openMinjiDatabase();
  return shared;
};
