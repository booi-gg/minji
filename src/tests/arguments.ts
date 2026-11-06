import type { TestKind } from "../runner/types.ts";

/** Split a stored argument array into editable JSON fragments without changing their formatting. */
export const splitArguments = (text: string): string[] | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const body = trimmed.slice(1, -1);
  if (body.trim() === "") return [];

  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "[" || character === "{") depth += 1;
    if (character === "]" || character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || escaped || depth !== 0) return null;
  parts.push(body.slice(start).trim());
  return parts;
};

export const joinArguments = (parts: readonly string[]): string => `[${parts.join(", ")}]`;

/**
 * The input to show after changing a case's test type. Function arguments become a call;
 * text that doesn't fit the new type stays, so switching back doesn't lose it.
 */
export const argsTextForKind = (
  test: { argsText: string; kind?: TestKind },
  kind: TestKind,
  functionName: string,
): string => {
  if (kind === "class" && test.argsText === "[]") return JSON.stringify([[functionName], [[]]]);
  if (kind !== "expression") return test.argsText;
  if (test.kind === "class") return `new ${functionName}()`;
  const parts = splitArguments(test.argsText);
  return parts === null ? test.argsText : `${functionName}(${parts.join(", ")})`;
};
