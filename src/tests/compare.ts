// Comparison of expected and actual values. See specs/test-cases.md, "Comparison".
import type { Encoded } from "../runner/types.ts";

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

const compareAt = (expected: Encoded, actual: Encoded, path: string): Comparison => {
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
      const result = compareAt(left[index] ?? null, right[index] ?? null, `${path}[${index}]`);
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
      const result = compareAt(left[key] ?? null, right[key] ?? null, `${path}${keySegment(key)}`);
      if (!result.equal) return result;
    }
    return { equal: true };
  }

  return left === right ? { equal: true } : { equal: false, path };
};

/** Deep equality for encoded JSON values; reports the path of the first difference. */
export const compare = (expected: Encoded, actual: Encoded): Comparison =>
  compareAt(expected, actual, "");

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
