import { splitTopLevel } from "../import/parseProblem.ts";

export interface EntryPoint {
  name: string;
  params: string[];
}

const FUNCTION_PATTERNS = [
  /^[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm,
  /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*\(([^)]*)\)/gm,
  /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]+)?=>/gm,
];
const CLASS_PATTERN = /^[ \t]*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)\b/gm;
const PARAM_NAME = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)(?=\s|[?:=]|$)/;
const NOT_SPACE = /\S/;

const indentOf = (declaration: string): number => declaration.search(NOT_SPACE);

const parameterNames = (text: string): string[] | undefined => {
  const names = splitTopLevel(text, true).map((part) => PARAM_NAME.exec(part)?.[1]);
  if (!names.every((name): name is string => name !== undefined)) return undefined;
  return new Set(names).size === names.length ? names : undefined;
};

/** Keep a known entry point; otherwise infer only when one candidate is outermost. */
export const entryPointFromSource = (
  source: string,
  preferredName: string,
): EntryPoint | undefined => {
  const candidates = new Map<string, EntryPoint>();
  const indents = new Map<string, number>();
  for (const pattern of FUNCTION_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined) continue;
      const params = parameterNames(match[2] ?? "");
      if (params === undefined) continue;
      candidates.set(name, { name, params });
      indents.set(name, indentOf(match[0]));
    }
  }
  for (const match of source.matchAll(CLASS_PATTERN)) {
    const name = match[1];
    if (name === undefined) continue;
    candidates.set(name, { name, params: [] });
    indents.set(name, indentOf(match[0]));
  }
  const known = candidates.get(preferredName);
  if (known !== undefined) return known;
  const outermostIndent = Math.min(...indents.values());
  const outermost = [...candidates.values()].filter(
    ({ name }) => indents.get(name) === outermostIndent,
  );
  return outermost.length === 1 ? outermost[0] : undefined;
};
