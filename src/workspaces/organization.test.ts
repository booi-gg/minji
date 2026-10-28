import { expect, it } from "vite-plus/test";
import { createWorkspace } from "./model.ts";
import { normalizeFolder, parseTags } from "./organization.ts";

it("normalizes folder and tag names without duplicate tags", () => {
  expect(normalizeFolder("  Arrays  ")).toBe("Arrays");
  expect(parseTags("easy, Arrays, arrays, , Dynamic Programming")).toEqual([
    "easy",
    "Arrays",
    "Dynamic Programming",
  ]);
  expect(createWorkspace({ folder: "  Graphs ", tags: ["BFS", "bfs"] })).toMatchObject({
    folder: "Graphs",
    tags: ["BFS"],
  });
});
