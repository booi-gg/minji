import type { CompareTarget, Language } from "../runner/types.ts";
import type { TestCase, Workspace } from "../workspaces/model.ts";

export interface WorkspaceDoc extends Pick<
  Workspace,
  | "title"
  | "statement"
  | "notes"
  | "folder"
  | "tags"
  | "language"
  | "functionName"
  | "params"
  | "source"
  | "starterSource"
  | "testTimeoutMs"
  | "createdAt"
  | "updatedAt"
> {
  tests: Pick<
    TestCase,
    | "id"
    | "position"
    | "label"
    | "argsText"
    | "expectedText"
    | "compare"
    | "kind"
    | "inputAdapters"
    | "outputAdapter"
    | "comparison"
  >[];
}

export interface SyncItem {
  id: string;
  revision: number;
  seq: number;
  deleted: boolean;
  doc: WorkspaceDoc | null;
}

export interface RevisionDto {
  id: string;
  language: Language;
  source: string;
  reason: "run" | "save";
  createdAt: string;
}

export interface Account {
  id: string;
  login: string;
  avatarUrl: string | null;
}

export interface ApiError {
  error: string;
  message: string;
  revision?: number;
  doc?: WorkspaceDoc | null;
  deleted?: boolean;
}

export const workspaceDoc = (workspace: Workspace, tests: TestCase[]): WorkspaceDoc => ({
  title: workspace.title,
  statement: workspace.statement,
  notes: workspace.notes,
  folder: workspace.folder,
  tags: workspace.tags,
  language: workspace.language,
  functionName: workspace.functionName,
  params: workspace.params,
  source: workspace.source,
  starterSource: workspace.starterSource,
  testTimeoutMs: workspace.testTimeoutMs,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
  tests: tests.map(
    ({
      id,
      position,
      label,
      argsText,
      expectedText,
      compare,
      kind,
      inputAdapters,
      outputAdapter,
      comparison,
    }) => ({
      id,
      position,
      label,
      argsText,
      expectedText,
      compare,
      kind,
      inputAdapters,
      outputAdapter,
      comparison,
    }),
  ),
});

export const isCompareTarget = (value: unknown): value is CompareTarget => {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "return") return true;
  return (
    value.kind === "argument" &&
    "index" in value &&
    typeof value.index === "number" &&
    Number.isInteger(value.index) &&
    value.index >= 0
  );
};
