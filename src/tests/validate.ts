// Test case validation and messages from specs/test-cases.md.
import { MAX_TEST_INPUT_BYTES } from "../shared/limits.ts";
import { isValidIdentifier } from "../shared/ids.ts";
import type { TestCase } from "../workspaces/model.ts";

export const KNOWN_TAGS = new Set(["undefined", "NaN", "Infinity", "-Infinity", "-0", "object"]);
const TAG = "$minji";
const MAX_ADAPTER_NODES = 100_000;

export interface TestValidation {
  args?: string;
  expected?: string;
  compare?: string;
  options?: string;
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
  test: Pick<TestCase, "argsText" | "expectedText" | "compare"> &
    Partial<Pick<TestCase, "kind" | "inputAdapters" | "outputAdapter" | "comparison">>,
  params: readonly string[] = [],
  functionName?: string,
): TestValidation => {
  const result: TestValidation = { valid: true };
  let parsedArgs: unknown[] | undefined;
  let parsedExpected: unknown;

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
        parsedArgs = parsed;
      } else {
        result.args =
          "Arguments must be a JSON array, one entry per parameter, e.g. [[2,7,11,15], 9]";
      }
    }
  }

  const kind = test.kind ?? "function";
  if (kind !== "function" && kind !== "class") result.options = "Unknown test type.";
  if (kind === "class" && parsedArgs !== undefined) {
    const [methods, inputs] = parsedArgs;
    const validMethods =
      Array.isArray(methods) &&
      methods.length > 0 &&
      methods.every(
        (name, index) =>
          typeof name === "string" &&
          isValidIdentifier(name) &&
          (index === 0 || !["constructor", "__proto__", "prototype"].includes(name)),
      );
    const validInputs = Array.isArray(inputs) && inputs.every(Array.isArray);
    if (
      parsedArgs.length !== 2 ||
      !validMethods ||
      !validInputs ||
      methods.length !== inputs.length ||
      (functionName !== undefined && methods[0] !== functionName)
    ) {
      result.args = `Class calls must be [["${functionName ?? "ClassName"}", "method"], [[], [arguments]]], with one argument array per call.`;
    }
    if (test.compare.kind !== "return") result.compare = "Class tests compare the method results.";
  }
  const adapters = test.inputAdapters ?? [];
  const validAdapter = (adapter: unknown): boolean =>
    adapter === "plain" || adapter === "linked-list" || adapter === "binary-tree";
  if (
    !Array.isArray(adapters) ||
    adapters.some((adapter) => !validAdapter(adapter)) ||
    !validAdapter(test.outputAdapter ?? "plain")
  )
    result.options = "Unknown node adapter.";
  if (
    kind === "class" &&
    (adapters.some((adapter) => adapter !== "plain") || (test.outputAdapter ?? "plain") !== "plain")
  )
    result.options = "Node adapters are for function tests.";
  if (kind === "function" && parsedArgs !== undefined) {
    for (const [index, adapter] of adapters.entries()) {
      if (adapter === "plain") continue;
      const value = parsedArgs[index];
      if (
        !Array.isArray(value) ||
        value.length > MAX_ADAPTER_NODES ||
        (adapter === "binary-tree" && value.length > 0 && value[0] === null)
      ) {
        result.args = `Argument ${index + 1} must be a node-value array for its adapter.`;
        break;
      }
    }
  }
  const tolerance = test.comparison?.tolerance;
  if (
    tolerance !== undefined &&
    (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0)
  )
    result.options = "Numeric tolerance must be a nonnegative finite number.";
  if (test.comparison?.unordered !== undefined && typeof test.comparison.unordered !== "boolean")
    result.options = "Unordered comparison must be on or off.";

  if (test.expectedText.trim() === "") {
    result.expected = "Expected value isn't valid JSON: it's empty.";
  } else {
    const error = parseError(test.expectedText);
    if (error !== undefined) {
      result.expected = `Expected value isn't valid JSON: ${error}`;
    } else {
      parsedExpected = JSON.parse(test.expectedText) as unknown;
      const tag = unknownTag(parsedExpected);
      if (tag !== undefined) {
        result.expected = `Unknown special value "${tag}". Use undefined, NaN, Infinity, -Infinity or -0.`;
      }
    }
  }
  if (
    kind === "class" &&
    parsedArgs !== undefined &&
    Array.isArray(parsedArgs[0]) &&
    Array.isArray(parsedExpected) &&
    parsedExpected.length !== parsedArgs[0].length
  )
    result.expected = `Class expected results need ${parsedArgs[0].length} entries, including null for the constructor.`;
  if (
    (kind === "class" ||
      (test.outputAdapter ?? "plain") !== "plain" ||
      test.comparison?.unordered) &&
    parsedExpected !== undefined &&
    !Array.isArray(parsedExpected)
  )
    result.expected = "Expected value must be a JSON array for this test setting.";

  if (
    kind === "function" &&
    test.compare.kind === "argument" &&
    result.argCount !== undefined &&
    test.compare.index >= result.argCount
  ) {
    result.compare = `There is no argument ${test.compare.index + 1} to compare.`;
  }

  if (
    kind === "function" &&
    result.argCount !== undefined &&
    params.length > 0 &&
    result.argCount !== params.length
  ) {
    const noun = params.length === 1 ? "argument" : "arguments";
    result.warning = `Expected ${params.length} ${noun} (${listNames(params)}), found ${result.argCount}.`;
  }

  result.valid =
    result.args === undefined &&
    result.expected === undefined &&
    result.compare === undefined &&
    result.options === undefined;
  return result;
};
