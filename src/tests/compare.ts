// Comparison of expected and actual values. See specs/test-cases.md, "Comparison".
import type { ComparisonOptions, Encoded } from "../runner/types.ts";

export type Comparison = { equal: true } | { equal: false; path: string };

type EncodedObject = { [key: string]: Encoded };

const TAG = "$minji";
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const isObject = (value: Encoded): value is EncodedObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tagOf = (value: Encoded): string | undefined => {
  if (!isObject(value)) return undefined;
  const tag = value[TAG];
  return typeof tag === "string" && Object.keys(value).length === (tag === "object" ? 2 : 1)
    ? tag
    : undefined;
};

interface Normalised {
  value: Encoded;
  /** An unwrapped `{"$minji":"object"}` payload: plain data even if it looks like a tag. */
  literal: boolean;
}

/** Unwraps `{"$minji":"object","value":…}` and treats `-0` as `0`. */
const normalise = (value: Encoded): Normalised => {
  const tag = tagOf(value);
  if (tag === "object" && isObject(value)) return { value: value.value ?? {}, literal: true };
  if (tag === "-0") return { value: 0, literal: false };
  return { value, literal: false };
};

const keySegment = (key: string): string =>
  IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;

const kindOf = ({ value, literal }: Normalised): string => {
  const tag = literal ? undefined : tagOf(value);
  if (tag !== undefined) return `tag:${tag}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const compareAt = (
  expected: Encoded,
  actual: Encoded,
  path: string,
  tolerance: number,
): Comparison => {
  const normalisedLeft = normalise(expected);
  const normalisedRight = normalise(actual);
  const kind = kindOf(normalisedLeft);
  if (kind !== kindOf(normalisedRight)) return { equal: false, path };
  if (kind.startsWith("tag:")) return { equal: true };
  const left = normalisedLeft.value;
  const right = normalisedRight.value;

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return { equal: false, path };
    for (let index = 0; index < left.length; index += 1) {
      const result = compareAt(
        left[index] ?? null,
        right[index] ?? null,
        `${path}[${index}]`,
        tolerance,
      );
      if (!result.equal) return result;
    }
    return { equal: true };
  }

  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = new Set(Object.keys(right));
    for (const key of leftKeys) {
      if (!rightKeys.has(key)) return { equal: false, path: `${path}${keySegment(key)}` };
    }
    for (const key of rightKeys) {
      if (!(key in left)) return { equal: false, path: `${path}${keySegment(key)}` };
    }
    for (const key of leftKeys) {
      const result = compareAt(
        left[key] ?? null,
        right[key] ?? null,
        `${path}${keySegment(key)}`,
        tolerance,
      );
      if (!result.equal) return result;
    }
    return { equal: true };
  }

  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) <= tolerance ? { equal: true } : { equal: false, path };
  }
  return left === right ? { equal: true } : { equal: false, path };
};

const MAX_UNORDERED_ITEMS = 1000;

/** Match array elements one to one, including duplicates and overlapping tolerance ranges. */
const compareUnordered = (
  expected: Encoded[],
  actual: Encoded[],
  tolerance: number,
): Comparison => {
  if (expected.length !== actual.length || expected.length > MAX_UNORDERED_ITEMS)
    return { equal: false, path: "" };
  const matched = new Int32Array(actual.length).fill(-1);
  const edges = expected.map((item) =>
    actual.map((candidate) => compareAt(item, candidate, "", tolerance).equal),
  );
  const assign = (index: number, seen: Uint8Array): boolean => {
    for (let candidate = 0; candidate < actual.length; candidate += 1) {
      if (!edges[index]?.[candidate] || seen[candidate]) continue;
      seen[candidate] = 1;
      const previous = matched[candidate];
      if (previous === -1 || assign(previous, seen)) {
        matched[candidate] = index;
        return true;
      }
    }
    return false;
  };
  for (let index = 0; index < expected.length; index += 1) {
    if (!assign(index, new Uint8Array(actual.length))) return { equal: false, path: `[${index}]` };
  }
  return { equal: true };
};

/** Deep equality; unordered comparison applies to the outer array only. */
export const compare = (
  expected: Encoded,
  actual: Encoded,
  options: ComparisonOptions = {},
): Comparison => {
  const tolerance = options.tolerance ?? 0;
  if (options.unordered && Array.isArray(expected) && Array.isArray(actual))
    return compareUnordered(expected, actual, tolerance);
  return compareAt(expected, actual, "", tolerance);
};

const TAG_TEXT: Record<string, string> = {
  undefined: "undefined",
  NaN: "NaN",
  Infinity: "Infinity",
  "-Infinity": "-Infinity",
  "-0": "-0",
};

const COMPACT_WIDTH = 60;

const printCompact = (value: Encoded, literal = false): string => {
  const tag = literal ? undefined : tagOf(value);
  if (tag !== undefined && tag !== "object") return TAG_TEXT[tag] ?? JSON.stringify(value);
  if (tag === "object" && isObject(value)) return printCompact(value.value ?? {}, true);
  if (Array.isArray(value)) return `[${value.map((item) => printCompact(item)).join(", ")}]`;
  if (isObject(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${printCompact(item)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return JSON.stringify(value);
};

const printIndented = (value: Encoded, indent: string, literal = false): string => {
  const compact = printCompact(value, literal);
  if (compact.length <= COMPACT_WIDTH) return compact;
  const inner = `${indent}  `;
  const tag = literal ? undefined : tagOf(value);
  if (tag === "object" && isObject(value)) return printIndented(value.value ?? {}, indent, true);
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${printIndented(item, inner)}`).join(",\n")}\n${indent}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${inner}${JSON.stringify(key)}: ${printIndented(item, inner)}`,
    );
    return `{\n${entries.join(",\n")}\n${indent}}`;
  }
  return compact;
};

/** Readable text for an encoded value: tags as `undefined`, `NaN`…, compact when short. */
export const formatEncoded = (value: Encoded): string => printIndented(value, "");
