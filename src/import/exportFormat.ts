// The versioned JSON format used for export and JSON import. See specs/data-model.md.
import type { WorkspaceBundle } from "../db/workspaces.ts";
import type {
  CompareTarget,
  ComparisonOptions,
  Language,
  NodeAdapter,
  TestKind,
} from "../runner/types.ts";
import { isValidIdentifier, newId } from "../shared/ids.ts";
import { MAX_TEST_TIMEOUT_MS, MIN_TEST_TIMEOUT_MS } from "../shared/limits.ts";
import { createWorkspace, type Revision, type TestCase } from "../workspaces/model.ts";

export const EXPORT_FORMAT = "minji.workspaces";
export const EXPORT_VERSION = 1;

export interface ExportedTest {
  label: string;
  /** A JSON value when the stored text is valid JSON, otherwise the raw text. */
  args: unknown;
  expected: unknown;
  compare: CompareTarget;
  kind?: TestKind;
  inputAdapters?: NodeAdapter[];
  outputAdapter?: NodeAdapter;
  comparison?: ComparisonOptions;
}

export interface ExportedRevision {
  language: Language;
  source: string;
  reason: "run" | "save";
  createdAt: string;
}

export interface ExportedWorkspace {
  title: string;
  statement: string;
  notes: string;
  folder?: string;
  tags?: string[];
  language: Language;
  functionName: string;
  params: string[];
  source: string;
  starterSource: string;
  testTimeoutMs: number;
  tests: ExportedTest[];
  revisions: ExportedRevision[];
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  workspaces: ExportedWorkspace[];
}

// Strings in the file mean raw editor text, so a value that is itself a JSON string
// (`"abc"`) is written as its raw text (`"\"abc\""`) to survive the round trip.
const toJsonValue = (text: string): unknown => {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "string" ? text : value;
  } catch {
    return text;
  }
};

export const toExportFile = (bundles: WorkspaceBundle[], now: Date = new Date()): ExportFile => ({
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exportedAt: now.toISOString(),
  workspaces: bundles.map(({ workspace, tests, revisions }) => ({
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
    tests: tests.map((test) => ({
      label: test.label,
      args: toJsonValue(test.argsText),
      expected: toJsonValue(test.expectedText),
      compare: test.compare,
      kind: test.kind,
      inputAdapters: test.inputAdapters,
      outputAdapter: test.outputAdapter,
      comparison: test.comparison,
    })),
    revisions: revisions.map(({ language, source, reason, createdAt }) => ({
      language,
      source,
      reason,
      createdAt,
    })),
  })),
});

const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40);

/** `minji-<slug-or-all>-<yyyy-mm-dd>.json` */
export const exportFileName = (titles: string[], now: Date = new Date()): string => {
  const date = now.toISOString().slice(0, 10);
  const slug = titles.length === 1 ? slugOf(titles[0] ?? "") || "untitled" : "all";
  return `minji-${slug}-${date}.json`;
};

// ---- Import ----------------------------------------------------------------------

export type ParseResult =
  | { ok: true; workspaces: ExportedWorkspace[]; skipped: { index: number; reason: string }[] }
  | { ok: false; message: string };

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const languageOf = (value: unknown): Language =>
  value === "javascript" || value === "typescript" ? value : "typescript";

const toRawText = (value: unknown, fallback: string): string => {
  if (value === undefined) return fallback;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const compareOf = (value: unknown): CompareTarget => {
  if (isObject(value) && value.kind === "argument" && Number.isInteger(value.index)) {
    const index = value.index as number;
    if (index >= 0) return { kind: "argument", index };
  }
  return { kind: "return" };
};

const testOf = (value: unknown): ExportedTest | undefined => {
  if (!isObject(value)) return undefined;
  return {
    label: stringOr(value.label, ""),
    args: value.args === undefined ? "[]" : value.args,
    expected: value.expected === undefined ? "" : value.expected,
    compare: compareOf(value.compare),
    kind: value.kind === "class" ? "class" : "function",
    inputAdapters: Array.isArray(value.inputAdapters)
      ? value.inputAdapters.map((adapter) =>
          adapter === "linked-list" || adapter === "binary-tree" ? adapter : "plain",
        )
      : undefined,
    outputAdapter:
      value.outputAdapter === "linked-list" || value.outputAdapter === "binary-tree"
        ? value.outputAdapter
        : "plain",
    comparison: isObject(value.comparison)
      ? {
          unordered: value.comparison.unordered === true,
          tolerance:
            typeof value.comparison.tolerance === "number" &&
            Number.isFinite(value.comparison.tolerance) &&
            value.comparison.tolerance >= 0
              ? value.comparison.tolerance
              : undefined,
        }
      : undefined,
  };
};

const revisionOf = (value: unknown): ExportedRevision | undefined => {
  if (!isObject(value) || typeof value.source !== "string" || typeof value.createdAt !== "string") {
    return undefined;
  }
  return {
    language: languageOf(value.language),
    source: value.source,
    reason: value.reason === "run" ? "run" : "save",
    createdAt: value.createdAt,
  };
};

const timeoutOf = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_TEST_TIMEOUT_MS, Math.max(MIN_TEST_TIMEOUT_MS, Math.round(value)))
    : fallback;

const workspaceOf = (value: unknown): ExportedWorkspace | string => {
  if (!isObject(value)) return "not an object";
  if (typeof value.title !== "string") return "missing title";
  if (typeof value.source !== "string") return "missing source";
  const defaults = createWorkspace({});
  const functionName =
    typeof value.functionName === "string" && isValidIdentifier(value.functionName)
      ? value.functionName
      : defaults.functionName;
  const params = Array.isArray(value.params)
    ? value.params.filter(
        (param): param is string => typeof param === "string" && isValidIdentifier(param),
      )
    : [];
  const list = (entries: unknown) => (Array.isArray(entries) ? entries : []);
  return {
    title: value.title,
    statement: stringOr(value.statement, ""),
    notes: stringOr(value.notes, ""),
    folder: stringOr(value.folder, ""),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    language: languageOf(value.language),
    functionName,
    params,
    source: value.source,
    starterSource: stringOr(value.starterSource, value.source),
    testTimeoutMs: timeoutOf(value.testTimeoutMs, defaults.testTimeoutMs),
    tests: list(value.tests).flatMap((entry) => testOf(entry) ?? []),
    revisions: list(value.revisions).flatMap((entry) => revisionOf(entry) ?? []),
  };
};

/** Parses an export file. Invalid workspaces are skipped and reported; unknown fields ignored. */
export const parseExportFile = (text: string): ParseResult => {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: "This file isn't valid JSON." };
  }
  if (!isObject(data) || data.format !== EXPORT_FORMAT) {
    return { ok: false, message: "This isn't a minji export file." };
  }
  if (typeof data.version !== "number" || data.version > EXPORT_VERSION) {
    return { ok: false, message: "This file was made by a newer version of the app." };
  }
  if (!Array.isArray(data.workspaces)) {
    return { ok: false, message: "This file has no workspaces." };
  }
  const workspaces: ExportedWorkspace[] = [];
  const skipped: { index: number; reason: string }[] = [];
  data.workspaces.forEach((entry: unknown, index: number) => {
    const parsed = workspaceOf(entry);
    if (typeof parsed === "string") skipped.push({ index, reason: parsed });
    else workspaces.push(parsed);
  });
  return { ok: true, workspaces, skipped };
};

/** Turns an imported workspace into new local records with new ids. */
export const toBundle = (imported: ExportedWorkspace, now: Date = new Date()): WorkspaceBundle => {
  const workspace = createWorkspace(
    {
      title: imported.title,
      statement: imported.statement,
      notes: imported.notes,
      folder: imported.folder,
      tags: imported.tags,
      language: imported.language,
      functionName: imported.functionName,
      params: imported.params,
      source: imported.source,
      starterSource: imported.starterSource,
      testTimeoutMs: imported.testTimeoutMs,
    },
    now,
  );
  const tests: TestCase[] = imported.tests.map((test, position) => ({
    id: newId(),
    workspaceId: workspace.id,
    position,
    label: test.label,
    argsText: toRawText(test.args, "[]"),
    expectedText: toRawText(test.expected, ""),
    compare: test.compare,
    kind: test.kind,
    inputAdapters: test.inputAdapters,
    outputAdapter: test.outputAdapter,
    comparison: test.comparison,
  }));
  const revisions: Revision[] = imported.revisions.map((revision) => ({
    id: newId(),
    workspaceId: workspace.id,
    language: revision.language,
    source: revision.source,
    reason: revision.reason,
    createdAt: revision.createdAt,
    synced: false,
  }));
  return { workspace, tests, revisions };
};
