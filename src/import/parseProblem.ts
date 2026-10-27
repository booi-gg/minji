// Parses pasted or uploaded problem text into an import draft.
// See specs/workspaces-and-import.md, "Import". Parsing never fails: anything it can't
// place stays in the statement, and a warning says so.
import type { Language } from "../runner/types.ts";
import { isValidIdentifier } from "../shared/ids.ts";
import { DEFAULT_FUNCTION_NAME, scratchStub } from "../workspaces/model.ts";

export interface DraftArg {
  /** Parameter name from `name = value`, or null for a bare value. */
  name: string | null;
  /** JSON text when the value parsed, otherwise the raw text. */
  text: string;
  valid: boolean;
}

export interface DraftTest {
  label: string;
  args: DraftArg[];
  expectedText: string;
  expectedValid: boolean;
}

export interface ImportDraft {
  title: string;
  statement: string;
  language: Language;
  functionName: string;
  params: string[];
  /** False when the parameter order was guessed from the examples. */
  paramsConfirmed: boolean;
  starterSource: string;
  tests: DraftTest[];
  suggestInPlace: boolean;
  warnings: string[];
}

export interface ProblemInput {
  text: string;
  /** Optional starter code pasted separately. */
  starter?: string;
  format: "text" | "markdown";
  fallbackLanguage: Language;
}

// ---- Title -----------------------------------------------------------------------

const MAX_TITLE_LENGTH = 120;
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const NOT_A_TITLE = /^(example|input|output|constraints)\b/i;
const LEADING_NUMBER = /^\d+\.\s*/;

const takeTitle = (lines: string[], format: ProblemInput["format"]): string => {
  if (format === "markdown") {
    const index = lines.findIndex((line) => MARKDOWN_HEADING.test(line));
    if (index !== -1) {
      const title = MARKDOWN_HEADING.exec(lines[index] ?? "")?.[1] ?? "";
      lines.splice(index, 1);
      return title;
    }
  }
  const index = lines.findIndex((line) => line.trim() !== "");
  const first = lines[index]?.trim() ?? "";
  if (index === -1 || first.length > MAX_TITLE_LENGTH || NOT_A_TITLE.test(first)) return "";
  lines.splice(index, 1);
  return first.replace(LEADING_NUMBER, "");
};

// ---- Starter code ----------------------------------------------------------------

const FENCE = /^\s*```\s*([\w-]*)\s*$/;
const CODE_FENCE_LANGUAGES: Record<string, Language> = {
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
};

/** Removes and returns the first fenced block tagged js/ts. */
const takeFencedStarter = (lines: string[]): { code: string; language: Language } | undefined => {
  for (let start = 0; start < lines.length; start += 1) {
    const tag = FENCE.exec(lines[start] ?? "")?.[1]?.toLowerCase() ?? "";
    const language = CODE_FENCE_LANGUAGES[tag];
    if (language === undefined) continue;
    const end = lines.findIndex((line, index) => index > start && FENCE.test(line));
    if (end === -1) return undefined;
    const code = lines.slice(start + 1, end).join("\n");
    lines.splice(start, end - start + 1);
    return { code: `${code}\n`, language };
  }
  return undefined;
};

const PARAM_TYPE = /\w\s*\??\s*:\s*[\w[\]<>|, ]+[,)=]/;
const RETURN_TYPE = /\)\s*:\s*[\w[\]<>|]+\s*\{/;

const detectLanguage = (code: string): Language | undefined =>
  PARAM_TYPE.test(code) || RETURN_TYPE.test(code) ? "typescript" : undefined;

const FUNCTION_PATTERNS = [
  /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/,
  /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*\(([^)]*)\)/,
  /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]+)?=>/,
];

/** Splits on commas that aren't inside brackets, braces, parens, angle brackets or quotes. */
export const splitTopLevel = (text: string, angleBrackets = false): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote !== null) {
      current += char;
      if (char === "\\") {
        current += text[index + 1] ?? "";
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("[{(".includes(char) || (angleBrackets && char === "<")) depth += 1;
    else if ("]})".includes(char) || (angleBrackets && char === ">")) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
};

const PARAM_NAME = /^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)/;

/** The first function the starter code defines, with its parameter names. */
export const findFunction = (code: string): { name: string; params: string[] } | undefined => {
  let best: { index: number; name: string; rawParams: string } | undefined;
  for (const pattern of FUNCTION_PATTERNS) {
    const match = pattern.exec(code);
    if (match?.[1] !== undefined && (best === undefined || match.index < best.index)) {
      best = { index: match.index, name: match[1], rawParams: match[2] ?? "" };
    }
  }
  if (best === undefined || !isValidIdentifier(best.name)) return undefined;
  const params = splitTopLevel(best.rawParams, true)
    .map((param) => PARAM_NAME.exec(param)?.[1] ?? "")
    .filter((param) => isValidIdentifier(param));
  return { name: best.name, params };
};

// ---- Examples --------------------------------------------------------------------

const EXAMPLE_HEADING = /^\s*(?:#+\s*)?Example\s*\d*\s*:?\s*$/i;
const SECTION_END = /^\s*(?:#+\s*)?(?:constraints|follow[- ]?up|note)\b/i;
const FIELD = /^\s*(input|output|explanation)\s*:\s*(.*)$/i;
const NAMED_ARG = /^\s*([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*)$/;
const SINGLE_QUOTED = /'((?:[^'\\]|\\.)*)'/g;

/** Strips Markdown emphasis, inline code marks and quote markers so labels are found. */
const plain = (line: string): string =>
  line
    .replace(/^\s*>\s?/, "")
    .replaceAll("**", "")
    .replaceAll("__", "")
    .replaceAll("`", "");

const parseValue = (raw: string): { text: string; valid: boolean } => {
  const trimmed = raw.trim();
  const attempt = (text: string): string | undefined => {
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return undefined;
    }
  };
  const direct = attempt(trimmed);
  if (direct !== undefined) return { text: direct, valid: true };
  const requoted = attempt(
    trimmed.replace(SINGLE_QUOTED, (_, inner: string) =>
      JSON.stringify(inner.replaceAll("\\'", "'")),
    ),
  );
  if (requoted !== undefined) return { text: requoted, valid: true };
  return { text: trimmed, valid: false };
};

interface RawExample {
  input: string;
  output: string;
}

const readExamples = (lines: string[]): RawExample[] => {
  const examples: RawExample[] = [];
  let current: RawExample | null = null;
  let field: "input" | "output" | null = null;

  const finish = (): void => {
    if (current !== null && (current.input !== "" || current.output !== "")) examples.push(current);
    current = null;
    field = null;
  };

  for (const original of lines) {
    const line = plain(original);
    if (EXAMPLE_HEADING.test(line)) {
      finish();
      current = { input: "", output: "" };
      continue;
    }
    if (current === null) continue;
    if (SECTION_END.test(line)) {
      finish();
      continue;
    }
    if (FENCE.test(line)) continue;
    const match = FIELD.exec(line);
    if (match !== null) {
      const label = (match[1] ?? "").toLowerCase();
      field = label === "explanation" ? null : (label as "input" | "output");
      if (field !== null) current[field] = (match[2] ?? "").trim();
      continue;
    }
    if (line.trim() === "") {
      field = null;
      continue;
    }
    if (field !== null) current[field] += `\n${line}`;
  }
  finish();
  return examples;
};

const parseInput = (input: string): DraftArg[] => {
  const parts = splitTopLevel(input);
  return parts.map((part) => {
    const named = NAMED_ARG.exec(part);
    const name = named?.[1] ?? null;
    const value = parseValue(named === null ? part : (named[2] ?? ""));
    return { name, ...value };
  });
};

// ---- Draft -----------------------------------------------------------------------

const IN_PLACE = /in[- ]place|do not return anything|modify .* in place/i;

const tidyStatement = (lines: string[]): string =>
  lines
    .join("\n")
    .replaceAll(" ", " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const parseProblem = ({
  text,
  starter,
  format,
  fallbackLanguage,
}: ProblemInput): ImportDraft => {
  const warnings: string[] = [];
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const title = takeTitle(lines, format);

  const pastedStarter = starter?.trim() === "" ? undefined : starter;
  const fenced =
    pastedStarter === undefined && format === "markdown" ? takeFencedStarter(lines) : undefined;
  const starterCode = pastedStarter ?? fenced?.code;
  const statement = tidyStatement(lines);

  const language =
    fenced?.language ??
    (starterCode === undefined ? undefined : detectLanguage(starterCode)) ??
    (starterCode === undefined ? fallbackLanguage : "javascript");

  const found = starterCode === undefined ? undefined : findFunction(starterCode);
  if (starterCode !== undefined && found === undefined) {
    warnings.push("Couldn't find a function in the starter code; check the function name.");
  }

  const examples = readExamples(text.replaceAll("\r\n", "\n").split("\n"));
  if (examples.length === 0) warnings.push("No examples were found, so there are no tests yet.");

  const parsedExamples = examples.map((example) => ({
    args: parseInput(example.input),
    expected: parseValue(example.output),
  }));

  let params = found?.params ?? [];
  const paramsConfirmed = found !== undefined;
  if (!paramsConfirmed) {
    const firstNames =
      parsedExamples[0]?.args.flatMap((arg) => (arg.name === null ? [] : [arg.name])) ?? [];
    params = firstNames.filter((name) => isValidIdentifier(name));
  }

  const tests = parsedExamples.map(({ args, expected }, index) => {
    const label = `Example ${index + 1}`;
    for (const arg of args) {
      if (arg.name !== null && params.length > 0 && !params.includes(arg.name)) {
        warnings.push(`${label} has an argument "${arg.name}" that isn't a parameter.`);
      }
      if (!arg.valid)
        warnings.push(`${label} has an argument that isn't valid JSON; fix it below.`);
    }
    if (!expected.valid)
      warnings.push(`${label} has an output that isn't valid JSON; fix it below.`);
    return { label, args, expectedText: expected.text, expectedValid: expected.valid };
  });

  const functionName = found?.name ?? DEFAULT_FUNCTION_NAME;
  return {
    title,
    statement,
    language,
    functionName,
    params,
    paramsConfirmed,
    starterSource: starterCode ?? scratchStub(functionName, params),
    tests,
    suggestInPlace: IN_PLACE.test(text),
    warnings,
  };
};

/**
 * Positional arguments text for a draft test, ordered by `params`. Named arguments that
 * aren't parameters go last; missing parameters become null.
 */
export const argsTextFor = (test: DraftTest, params: readonly string[]): string => {
  const named = test.args.every((arg) => arg.name !== null);
  if (!named || params.length === 0) return `[${test.args.map((arg) => arg.text).join(", ")}]`;
  const byName = new Map(test.args.map((arg) => [arg.name, arg.text]));
  const ordered = params.map((param) => byName.get(param) ?? "null");
  const extras = test.args
    .filter((arg) => arg.name !== null && !params.includes(arg.name))
    .map((arg) => arg.text);
  return `[${[...ordered, ...extras].join(", ")}]`;
};
