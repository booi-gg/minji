// Workspace data types and constructors. See specs/data-model.md.
import { newId } from "../shared/ids.ts";
import { DEFAULT_TEST_TIMEOUT_MS } from "../shared/limits.ts";
import type {
  CompareTarget,
  ComparisonOptions,
  Language,
  NodeAdapter,
  TestKind,
} from "../runner/types.ts";
import type { RunOutcome, TestResult } from "../tests/results.ts";

export type SyncState = "local" | "excluded" | "dirty" | "synced" | "conflict" | "too-large";

export interface Workspace {
  id: string;
  /** '' shows as "Untitled". */
  title: string;
  statement: string;
  notes: string;
  language: Language;
  functionName: string;
  params: string[];
  source: string;
  starterSource: string;
  testTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  ownerId: string | null;
  syncRevision: number;
  syncState: SyncState;
  lastRun: { passed: number; total: number; at: string } | null;
}

export interface TestCase {
  id: string;
  workspaceId: string;
  position: number;
  label: string;
  argsText: string;
  expectedText: string;
  compare: CompareTarget;
  kind?: TestKind;
  inputAdapters?: NodeAdapter[];
  outputAdapter?: NodeAdapter;
  comparison?: ComparisonOptions;
}

export interface Revision {
  id: string;
  workspaceId: string;
  language: Language;
  source: string;
  reason: "run" | "save";
  createdAt: string;
  synced: boolean;
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  scope: "all" | "single";
  startedAt: string;
  durationMs: number;
  revisionId: string | null;
  outcome: RunOutcome;
  /** Run-level message for compile errors, rejected runs and crashes. */
  message: string | null;
  results: TestResult[];
}

export const DEFAULT_FUNCTION_NAME = "solve";
export const DEFAULT_LANGUAGE: Language = "typescript";
export const UNTITLED = "Untitled";

export const displayTitle = (workspace: Pick<Workspace, "title">): string =>
  workspace.title.trim() === "" ? UNTITLED : workspace.title;

/** Starter code for scratch workspaces and imports without starter code. */
export const scratchStub = (functionName: string, params: readonly string[] = []): string =>
  `function ${functionName}(${params.join(", ")}) {\n  \n}\n`;

export interface WorkspaceFields {
  title?: string;
  statement?: string;
  notes?: string;
  language?: Language;
  functionName?: string;
  params?: string[];
  source?: string;
  starterSource?: string;
  testTimeoutMs?: number;
}

/** A new local workspace. Missing fields get the scratch defaults from workspaces-and-import.md. */
export const createWorkspace = (fields: WorkspaceFields, now: Date = new Date()): Workspace => {
  const functionName = fields.functionName ?? DEFAULT_FUNCTION_NAME;
  const params = fields.params ?? [];
  const starterSource = fields.starterSource ?? fields.source ?? scratchStub(functionName, params);
  const timestamp = now.toISOString();
  return {
    id: newId(),
    title: fields.title ?? "",
    statement: fields.statement ?? "",
    notes: fields.notes ?? "",
    language: fields.language ?? DEFAULT_LANGUAGE,
    functionName,
    params,
    source: fields.source ?? starterSource,
    starterSource,
    testTimeoutMs: fields.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ownerId: null,
    syncRevision: 0,
    syncState: "local",
    lastRun: null,
  };
};
