import { splitTopLevel } from "../import/parseProblem.ts";

export interface EntryPoint {
  name: string;
  params: string[];
}

const FUNCTION_PATTERNS = [
  /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*\(([^)]*)\)/gm,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]+)?=>/gm,
];
const CLASS_PATTERN = /^\s*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)\b/gm;
const PARAM_NAME = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)(?=\s|[?:=]|$)/;

const parameterNames = (text: string): string[] | undefined => {
  const names = splitTopLevel(text, true).map((part) => PARAM_NAME.exec(part)?.[1]);
  if (!names.every((name): name is string => name !== undefined)) return undefined;
  return new Set(names).size === names.length ? names : undefined;
};

/** Keep a known entry point; otherwise infer only when the source has one candidate. */
export const entryPointFromSource = (
  source: string,
  preferredName: string,
): EntryPoint | undefined => {
  const candidates = new Map<string, EntryPoint>();
  for (const pattern of FUNCTION_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined) continue;
      const params = parameterNames(match[2] ?? "");
      if (params !== undefined) candidates.set(name, { name, params });
    }
  }
  for (const match of source.matchAll(CLASS_PATTERN)) {
    const name = match[1];
    if (name !== undefined) candidates.set(name, { name, params: [] });
  }
  return (
    candidates.get(preferredName) ??
    (candidates.size === 1 ? candidates.values().next().value : undefined)
  );
};
