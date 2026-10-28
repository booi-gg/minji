// Runs a problem file through the app's own importers and reports what Import would produce.
// Usage: vpx .claude/skills/problem-file/check.ts <file.md|file.txt|file.json>
// Exits 1 when the file has parse warnings or invalid tests.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseExportFile, toBundle } from "../../../src/import/exportFormat.ts";
import { argsTextFor, parseProblem } from "../../../src/import/parseProblem.ts";
import { validateTest } from "../../../src/tests/validate.ts";

interface Summary {
  title: string;
  language: string;
  functionName: string;
  params: readonly string[];
  paramsConfirmed: boolean;
  warnings: string[];
  tests: { label: string; argsText: string; expectedText: string; problem?: string }[];
}

const problemOf = (validation: ReturnType<typeof validateTest>): string | undefined =>
  validation.valid ? undefined : (validation.args ?? validation.expected ?? validation.options);

const fromText = (text: string, format: "markdown" | "text"): Summary => {
  const draft = parseProblem({ text, format, fallbackLanguage: "typescript" });
  return {
    ...draft,
    tests: draft.tests.map((test) => {
      const argsText = argsTextFor(test, draft.params);
      const validation = validateTest(
        { argsText, expectedText: test.expectedText, compare: { kind: "return" } },
        draft.params,
        draft.functionName,
      );
      return {
        label: test.label,
        argsText,
        expectedText: test.expectedText,
        problem: problemOf(validation),
      };
    }),
  };
};

const fromJson = (text: string): Summary[] => {
  const result = parseExportFile(text);
  if (!result.ok) throw new Error(result.message);
  return result.workspaces.map((imported) => {
    const { workspace, tests } = toBundle(imported);
    return {
      title: workspace.title,
      language: workspace.language,
      functionName: workspace.functionName,
      params: workspace.params,
      paramsConfirmed: true,
      warnings: [],
      tests: tests.map((test) => ({
        label: test.label,
        argsText: test.argsText,
        expectedText: test.expectedText,
        problem: problemOf(validateTest(test, workspace.params, workspace.functionName)),
      })),
    };
  });
};

const file = process.argv[2];
if (file === undefined) throw new Error("Usage: vpx .claude/skills/problem-file/check.ts <file>");
const text = readFileSync(file, "utf8");
const extension = extname(file).toLowerCase();
const summaries =
  extension === ".json"
    ? fromJson(text)
    : [fromText(text, extension === ".txt" ? "text" : "markdown")];

let failed = false;
for (const summary of summaries) {
  const confirmed = summary.paramsConfirmed ? "" : " (guessed from examples)";
  process.stdout.write(
    `\n${summary.title || "(no title)"} · ${summary.language} · ${summary.functionName}(${summary.params.join(", ")})${confirmed}\n`,
  );
  for (const warning of summary.warnings) {
    failed = true;
    process.stdout.write(`  ! ${warning}\n`);
  }
  if (summary.tests.length === 0) {
    failed = true;
    process.stdout.write("  ! no tests found\n");
  }
  for (const test of summary.tests) {
    const mark = test.problem === undefined ? "✓" : "✗";
    if (test.problem !== undefined) failed = true;
    process.stdout.write(
      `  ${mark} ${test.label || "(unnamed)"}: ${test.argsText} → ${test.expectedText}${test.problem === undefined ? "" : `  [${test.problem}]`}\n`,
    );
  }
}
process.stdout.write(
  failed ? "\nNot clean: fix the lines marked ! or ✗.\n" : "\nClean: imports as shown.\n",
);
process.exitCode = failed ? 1 : 0;
