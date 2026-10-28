import { isValidIdentifier } from "../src/shared/ids.ts";
import {
  MAX_SOURCE_BYTES,
  MAX_SYNC_DOC_BYTES,
  MAX_TESTS_PER_WORKSPACE,
  MAX_TEST_TIMEOUT_MS,
  MIN_TEST_TIMEOUT_MS,
} from "../src/shared/limits.ts";
import { isCompareTarget, type RevisionDto, type WorkspaceDoc } from "../src/sync/protocol.ts";

const textBytes = (text: string): number => new TextEncoder().encode(text).length;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const isLanguage = (value: unknown): value is "javascript" | "typescript" =>
  value === "javascript" || value === "typescript";
const isText = (value: unknown): value is string => typeof value === "string";

export const isWorkspaceDoc = (value: unknown): value is WorkspaceDoc => {
  if (!isRecord(value)) return false;
  if (
    ![value.title, value.statement, value.notes].every(isText) ||
    !isText(value.source) ||
    !isText(value.starterSource)
  )
    return false;
  if (
    !isLanguage(value.language) ||
    !isText(value.functionName) ||
    !isValidIdentifier(value.functionName)
  )
    return false;
  if (
    !Array.isArray(value.params) ||
    !value.params.every((param) => isText(param) && isValidIdentifier(param))
  )
    return false;
  if (new Set(value.params).size !== value.params.length) return false;
  if (
    typeof value.testTimeoutMs !== "number" ||
    !Number.isInteger(value.testTimeoutMs) ||
    value.testTimeoutMs < MIN_TEST_TIMEOUT_MS ||
    value.testTimeoutMs > MAX_TEST_TIMEOUT_MS
  )
    return false;
  if (!isDate(value.createdAt) || !isDate(value.updatedAt)) return false;
  if (
    textBytes(value.source) > MAX_SOURCE_BYTES ||
    textBytes(value.starterSource) > MAX_SOURCE_BYTES
  )
    return false;
  if (!Array.isArray(value.tests) || value.tests.length > MAX_TESTS_PER_WORKSPACE) return false;
  const ids = new Set<string>();
  for (const test of value.tests) {
    if (!isRecord(test) || !isText(test.id) || test.id.length === 0 || ids.has(test.id))
      return false;
    ids.add(test.id);
    if (typeof test.position !== "number" || !Number.isInteger(test.position) || test.position < 0)
      return false;
    if (
      !isText(test.label) ||
      !isText(test.argsText) ||
      !isText(test.expectedText) ||
      !isCompareTarget(test.compare)
    )
      return false;
    const validAdapter = (adapter: unknown): boolean =>
      adapter === "plain" || adapter === "linked-list" || adapter === "binary-tree";
    if (test.kind !== undefined && test.kind !== "function" && test.kind !== "class") return false;
    if (
      test.inputAdapters !== undefined &&
      (!Array.isArray(test.inputAdapters) || !test.inputAdapters.every(validAdapter))
    )
      return false;
    if (test.outputAdapter !== undefined && !validAdapter(test.outputAdapter)) return false;
    if (test.comparison !== undefined) {
      if (!isRecord(test.comparison)) return false;
      if (test.comparison.unordered !== undefined && typeof test.comparison.unordered !== "boolean")
        return false;
      if (
        test.comparison.tolerance !== undefined &&
        (typeof test.comparison.tolerance !== "number" ||
          !Number.isFinite(test.comparison.tolerance) ||
          test.comparison.tolerance < 0)
      )
        return false;
    }
  }
  return textBytes(JSON.stringify(value)) <= MAX_SYNC_DOC_BYTES;
};

export const tooLargeDoc = (value: unknown): boolean =>
  value !== undefined && textBytes(JSON.stringify(value)) > MAX_SYNC_DOC_BYTES;

export const isRevisionDto = (value: unknown): value is RevisionDto =>
  isRecord(value) &&
  isText(value.id) &&
  value.id.length > 0 &&
  isLanguage(value.language) &&
  isText(value.source) &&
  textBytes(value.source) <= MAX_SOURCE_BYTES &&
  (value.reason === "run" || value.reason === "save") &&
  isDate(value.createdAt);

export const validBaseRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
