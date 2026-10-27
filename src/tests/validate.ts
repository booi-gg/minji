// Test case validation and messages from specs/test-cases.md.
import { MAX_TEST_INPUT_BYTES } from "../shared/limits.ts";
import type { TestCase } from "../workspaces/model.ts";

export const KNOWN_TAGS = new Set(["undefined", "NaN", "Infinity", "-Infinity", "-0", "object"]);
const TAG = "$minji";

export interface TestValidation {
  args?: string;
  expected?: string;
  compare?: string;
  /** Doesn't block a run. */
  warning?: string;
  valid: boolean;
  /** Parsed arguments when they are a valid JSON array. */
  argCount?: number;
}

const parseError = (text: string): string | undefined => {
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** The first `$minji` tag in `value` that isn't one we know. */
const unknownTag = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = unknownTag(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const tag = record[TAG];
  if (typeof tag === "string" && !KNOWN_TAGS.has(tag)) return tag;
  for (const item of Object.values(record)) {
    const found = unknownTag(item);
    if (found !== undefined) return found;
  }
  return undefined;
};

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const listNames = (params: readonly string[]): string => params.join(", ");

export const validateTest = (
  test: Pick<TestCase, "argsText" | "expectedText" | "compare">,
  params: readonly string[] = [],
): TestValidation => {
  const result: TestValidation = { valid: true };

  if (byteLength(test.argsText) > MAX_TEST_INPUT_BYTES) {
    result.args = "This input is larger than the 8 MB limit.";
  } else {
    const error = parseError(test.argsText);
    if (error !== undefined) {
      result.args = `Arguments aren't valid JSON: ${error}`;
    } else {
      const parsed = JSON.parse(test.argsText) as unknown;
      if (Array.isArray(parsed)) {
        result.argCount = parsed.length;
      } else {
        result.args =
          "Arguments must be a JSON array, one entry per parameter, e.g. [[2,7,11,15], 9]";
      }
    }
  }

  if (test.expectedText.trim() === "") {
    result.expected = "Expected value isn't valid JSON: it's empty.";
  } else {
    const error = parseError(test.expectedText);
    if (error !== undefined) {
      result.expected = `Expected value isn't valid JSON: ${error}`;
    } else {
      const tag = unknownTag(JSON.parse(test.expectedText));
      if (tag !== undefined) {
        result.expected = `Unknown special value "${tag}". Use undefined, NaN, Infinity, -Infinity or -0.`;
      }
    }
  }

  if (
    test.compare.kind === "argument" &&
    result.argCount !== undefined &&
    test.compare.index >= result.argCount
  ) {
    result.compare = `There is no argument ${test.compare.index + 1} to compare.`;
  }

  if (result.argCount !== undefined && params.length > 0 && result.argCount !== params.length) {
    const noun = params.length === 1 ? "argument" : "arguments";
    result.warning = `Expected ${params.length} ${noun} (${listNames(params)}), found ${result.argCount}.`;
  }

  result.valid =
    result.args === undefined && result.expected === undefined && result.compare === undefined;
  return result;
};
