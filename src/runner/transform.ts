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
