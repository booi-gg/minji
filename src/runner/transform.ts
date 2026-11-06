import { transform, type Transform } from "sucrase";
import type { Language } from "./types.ts";

export type TransformResult =
  | { ok: true; code: string }
  | { ok: false; message: string; line?: number; column?: number };

interface SucraseSyntaxError {
  message: string;
  loc?: { line: number; column: number };
}

const isSucraseSyntaxError = (error: unknown): error is SucraseSyntaxError =>
  error instanceof SyntaxError;

const LOCATION_SUFFIX = /\s*\(\d+:\d+\)$/;

const TYPE_ONLY: Transform[] = ["typescript"];

/**
 * Prepares a test's call expression for `eval`. The parentheses make `{ a: 1 }` an object
 * and the newline lets it end in a comment. Text that doesn't parse is returned as it is,
 * so `eval` throws and only that test fails.
 */
export const transformExpression = (expression: string, language: Language): string => {
  const wrapped = `(${expression}\n)`;
  if (language !== "typescript") return wrapped;
  try {
    return transform(wrapped, {
      transforms: TYPE_ONLY,
      disableESTransforms: true,
      production: true,
    }).code;
  } catch (error) {
    if (!isSucraseSyntaxError(error)) throw error;
    return wrapped;
  }
};

/**
 * Strips TypeScript types and turns `import`/`export` into CommonJS so the result can run
 * as a classic script. Sucrase keeps line numbers, so errors and stacks still point at the
 * user's source.
 */
export const transformSource = (source: string, language: Language): TransformResult => {
  const transforms: Transform[] =
    language === "typescript" ? ["typescript", "imports"] : ["imports"];
  try {
    const { code } = transform(source, { transforms, disableESTransforms: true, production: true });
    return { ok: true, code };
  } catch (error) {
    if (!isSucraseSyntaxError(error)) throw error;
    return {
      ok: false,
      message: error.message.replace(LOCATION_SUFFIX, ""),
      // Sucrase reports 1-based lines and 0-based columns.
      line: error.loc?.line,
      column: error.loc === undefined ? undefined : error.loc.column + 1,
    };
  }
};
