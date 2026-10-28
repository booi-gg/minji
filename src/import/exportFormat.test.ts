import { describe, expect, it } from "vite-plus/test";
import type { WorkspaceBundle } from "../db/workspaces.ts";
import { createWorkspace } from "../workspaces/model.ts";
import { exportFileName, parseExportFile, toBundle, toExportFile } from "./exportFormat.ts";

const NOW = new Date("2026-10-27T10:00:00.000Z");

const sampleBundle = (): WorkspaceBundle => {
  const workspace = createWorkspace(
    {
      title: "Two Sum",
      functionName: "twoSum",
      params: ["nums", "target"],
      statement: "Find two.",
    },
    NOW,
  );
  return {
    workspace,
    tests: [
      {
        id: "a",
        workspaceId: workspace.id,
        position: 0,
        label: "basic",
        argsText: "[[2,7,11,15], 9]",
        expectedText: "[0,1]",
        compare: { kind: "return" },
      },
      {
        id: "b",
        workspaceId: workspace.id,
        position: 1,
        label: "",
        argsText: "[[3,2,4], 6",
        expectedText: '"text"',
        compare: { kind: "argument", index: 0 },
      },
    ],
    revisions: [
      {
        id: "r",
        workspaceId: workspace.id,
        language: "typescript",
        source: "old",
        reason: "run",
        createdAt: "2026-10-26T00:00:00.000Z",
        synced: true,
      },
    ],
  };
};

describe("export", () => {
  it("writes valid JSON as values and invalid text as strings", () => {
    const file = toExportFile([sampleBundle()], NOW);
    expect(file).toMatchObject({
      format: "minji.workspaces",
      version: 1,
      exportedAt: NOW.toISOString(),
    });
    const [workspace] = file.workspaces;
    expect(workspace?.tests[0]).toMatchObject({ args: [[2, 7, 11, 15], 9], expected: [0, 1] });
    expect(workspace?.tests[1]).toMatchObject({ args: "[[3,2,4], 6", expected: '"text"' });
    expect(workspace?.revisions).toEqual([
      {
        language: "typescript",
        source: "old",
        reason: "run",
        createdAt: "2026-10-26T00:00:00.000Z",
      },
    ]);
    expect(workspace).not.toHaveProperty("id");
    expect(workspace).not.toHaveProperty("syncState");
  });

  it("names files by title or 'all'", () => {
    expect(exportFileName(["Two Sum!"], NOW)).toBe("minji-two-sum-2026-10-27.json");
    expect(exportFileName([""], NOW)).toBe("minji-untitled-2026-10-27.json");
    expect(exportFileName(["a", "b"], NOW)).toBe("minji-all-2026-10-27.json");
  });
});

describe("import", () => {
  it("preserves class, adapter, and comparison settings through export and import", () => {
    const original = sampleBundle();
    original.tests[0] = {
      ...original.tests[0],
      kind: "class",
      argsText: '[["Counter","get"],[[],[]]]',
      expectedText: "[null,0]",
      comparison: { unordered: false, tolerance: 0.01 },
    };
    original.tests[1] = {
      ...original.tests[1],
      inputAdapters: ["linked-list"],
      outputAdapter: "binary-tree",
      comparison: { unordered: true },
    };
    const parsed = parseExportFile(JSON.stringify(toExportFile([original], NOW)));
    if (!parsed.ok || parsed.workspaces[0] === undefined) throw new Error("Import failed");
    const restored = toBundle(parsed.workspaces[0], NOW);
    expect(restored.tests[0]).toMatchObject({ kind: "class", comparison: { tolerance: 0.01 } });
    expect(restored.tests[1]).toMatchObject({
      inputAdapters: ["linked-list"],
      outputAdapter: "binary-tree",
      comparison: { unordered: true },
    });
  });
  it("round-trips through the file format with new ids", () => {
    const original = sampleBundle();
    original.workspace.folder = "Arrays";
    original.workspace.tags = ["easy", "two pointers"];
    const parsed = parseExportFile(JSON.stringify(toExportFile([original], NOW)));
    if (!parsed.ok) throw new Error(parsed.message);
    const [imported] = parsed.workspaces;
    if (imported === undefined) throw new Error("no workspace");
    const bundle = toBundle(imported, NOW);

    expect(bundle.workspace.id).not.toBe(original.workspace.id);
    expect(bundle.workspace).toMatchObject({
      title: "Two Sum",
      functionName: "twoSum",
      params: ["nums", "target"],
      syncState: "local",
      ownerId: null,
      folder: "Arrays",
      tags: ["easy", "two pointers"],
    });
    expect(bundle.tests.map((test) => [test.argsText, test.expectedText])).toEqual([
      ["[[2,7,11,15],9]", "[0,1]"],
      ["[[3,2,4], 6", '"text"'],
    ]);
    expect(bundle.tests[1]?.compare).toEqual({ kind: "argument", index: 0 });
    expect(bundle.tests.every((test) => test.workspaceId === bundle.workspace.id)).toBe(true);
    expect(bundle.revisions[0]).toMatchObject({ source: "old", synced: false });
  });

  it("fills defaults when only title and source are given", () => {
    const parsed = parseExportFile(
      JSON.stringify({
        format: "minji.workspaces",
        version: 1,
        workspaces: [{ title: "T", source: "x" }],
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      skipped: [],
      workspaces: [
        {
          title: "T",
          source: "x",
          starterSource: "x",
          language: "typescript",
          functionName: "solve",
          tests: [],
        },
      ],
    });
  });

  it("skips invalid workspaces and reports them", () => {
    const parsed = parseExportFile(
      JSON.stringify({
        format: "minji.workspaces",
        version: 1,
        workspaces: [{ title: "ok", source: "" }, { title: 3 }, "nope"],
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      skipped: [
        { index: 1, reason: "missing title" },
        { index: 2, reason: "not an object" },
      ],
    });
  });

  it("cleans unsafe or out-of-range fields", () => {
    const parsed = parseExportFile(
      JSON.stringify({
        format: "minji.workspaces",
        version: 1,
        workspaces: [
          {
            title: "t",
            source: "s",
            functionName: "alert(1)",
            params: ["ok", "not ok", 3],
            language: "python",
            testTimeoutMs: 999_999,
            tests: [{ compare: { kind: "argument", index: -1 } }],
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      workspaces: [
        {
          functionName: "solve",
          params: ["ok"],
          language: "typescript",
          testTimeoutMs: 10_000,
          tests: [{ args: "[]", expected: "", compare: { kind: "return" } }],
        },
      ],
    });
  });

  it.each([
    ["not json", "This file isn't valid JSON."],
    ['{"format":"other"}', "This isn't a minji export file."],
    [
      '{"format":"minji.workspaces","version":2,"workspaces":[]}',
      "This file was made by a newer version of the app.",
    ],
    ['{"format":"minji.workspaces","version":1}', "This file has no workspaces."],
  ])("rejects %s", (text, message) => {
    expect(parseExportFile(text)).toEqual({ ok: false, message });
  });
});
