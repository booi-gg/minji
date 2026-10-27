import { describe, expect, it } from "vite-plus/test";
import type { Encoded } from "../runner/types.ts";
import { compare, formatEncoded } from "./compare.ts";

const equal = (expected: Encoded, actual: Encoded) => compare(expected, actual).equal;

describe("compare", () => {
  it("compares primitives and nested structures", () => {
    expect(equal([0, 1], [0, 1])).toBe(true);
    expect(equal({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true);
    expect(compare([0, 1, 2], [0, 1, 3])).toEqual({ equal: false, path: "[2]" });
    expect(compare({ a: { b: 1 } }, { a: { b: 2 } })).toEqual({ equal: false, path: ".a.b" });
  });

  it("ignores object key order", () => {
    expect(equal({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("reports missing and extra keys at their path", () => {
    expect(compare({ a: 1, "two words": 2 }, { a: 1 })).toEqual({
      equal: false,
      path: '["two words"]',
    });
    expect(compare({ a: 1 }, { a: 1, b: 2 })).toEqual({ equal: false, path: ".b" });
  });

  it("reports length mismatches at the array", () => {
    expect(compare({ list: [1, 2] }, { list: [1, 2, 3] })).toEqual({ equal: false, path: ".list" });
  });

  it("never equates different JSON types", () => {
    expect(equal(1, "1")).toBe(false);
    expect(equal([], {})).toBe(false);
    expect(equal(null, { $minji: "undefined" })).toBe(false);
    expect(compare(0, null)).toEqual({ equal: false, path: "" });
  });

  it("applies the tag rules", () => {
    expect(equal({ $minji: "-0" }, 0)).toBe(true);
    expect(equal(0, { $minji: "-0" })).toBe(true);
    expect(equal({ $minji: "NaN" }, { $minji: "NaN" })).toBe(true);
    expect(equal({ $minji: "NaN" }, 0)).toBe(false);
    expect(equal({ $minji: "undefined" }, { $minji: "undefined" })).toBe(true);
    expect(
      equal(
        { $minji: "object", value: { $minji: "NaN" } },
        { $minji: "object", value: { $minji: "NaN" } },
      ),
    ).toBe(true);
    expect(equal({ $minji: "object", value: { $minji: "NaN" } }, { $minji: "NaN" })).toBe(false);
  });
});

describe("formatEncoded", () => {
  it("prints short values compactly with tags as JavaScript words", () => {
    expect(formatEncoded([1, { $minji: "undefined" }, { $minji: "NaN" }])).toBe(
      "[1, undefined, NaN]",
    );
    expect(formatEncoded({ a: "x" })).toBe('{"a": "x"}');
    expect(formatEncoded({ $minji: "object", value: { $minji: "NaN" } })).toBe('{"$minji": "NaN"}');
  });

  it("indents long values", () => {
    const long = Array.from({ length: 30 }, (_, index) => index);
    expect(formatEncoded({ values: long })).toBe(
      `{\n  "values": [${long.join(", ")}]\n}`.replace(
        `[${long.join(", ")}]`,
        `[\n${long.map((value) => `    ${value}`).join(",\n")}\n  ]`,
      ),
    );
  });
});
