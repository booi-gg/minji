// Prettier formatting for the code editor, loaded on first use. See specs/practice-editor.md.
import type { Plugin } from "prettier";
import type { Language } from "../runner/types.ts";

export type FormatResult =
  | { ok: true; code: string }
  | { ok: false; message: string; line?: number };

interface Prettier {
  format: (source: string, options: Record<string, unknown>) => Promise<string>;
  plugins: Plugin[];
}

let prettier: Promise<Prettier> | undefined;

const loadPrettier = (): Promise<Prettier> => {
  prettier ??= Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
  ]).then(([standalone, babel, estree]) => ({
    format: standalone.format,
    // babel-ts parses TypeScript, so Prettier's much larger typescript plugin isn't needed.
    plugins: [babel as Plugin, estree as Plugin],
  }));
  return prettier;
};

const SYNTAX_LOCATION = /\((\d+):\d+\)/;

interface PrettierSyntaxError {
  message: string;
  loc?: { start?: { line?: number } };
}

export const formatCode = async (source: string, language: Language): Promise<FormatResult> => {
  const { format, plugins } = await loadPrettier();
  try {
    const code = await format(source, {
      parser: language === "typescript" ? "babel-ts" : "babel",
      plugins,
      tabWidth: 2,
    });
    return { ok: true, code };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const { message, loc } = error as PrettierSyntaxError;
    const fromMessage = SYNTAX_LOCATION.exec(message)?.[1];
    const line = loc?.start?.line ?? (fromMessage === undefined ? undefined : Number(fromMessage));
    return { ok: false, message: message.split("\n")[0] ?? message, line };
  }
};
