// One-time Monaco setup: workers, TypeScript options, and Prettier as the formatter.
// Imported only by the practice route, so Monaco stays out of the home-screen bundle.
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import type { Language } from "../runner/types.ts";
import { formatCode } from "./format.ts";

globalThis.MonacoEnvironment = {
  getWorker: (_workerId: string, label: string) =>
    label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker(),
};

// The runner has no DOM, so its types aren't loaded; only `console` exists.
const RUNNER_GLOBALS = `
interface Console {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
  debug(...data: unknown[]): void;
}
declare var console: Console;
declare class ListNode<T = unknown> {
  constructor(val?: T, next?: ListNode<T> | null);
  val: T;
  next: ListNode<T> | null;
}
declare class TreeNode<T = unknown> {
  constructor(val?: T, left?: TreeNode<T> | null, right?: TreeNode<T> | null);
  val: T;
  left: TreeNode<T> | null;
  right: TreeNode<T> | null;
}
`;

const { typescript } = monaco;
const compilerOptions = {
  target: typescript.ScriptTarget.ESNext,
  lib: ["es2023"],
  strict: true,
  noEmit: true,
  allowNonTsExtensions: true,
  allowJs: true,
};

for (const defaults of [typescript.typescriptDefaults, typescript.javascriptDefaults]) {
  defaults.setCompilerOptions(compilerOptions);
  defaults.addExtraLib(RUNNER_GLOBALS, "file:///runner-globals.d.ts");
  // Prettier replaces Monaco's built-in TypeScript formatter, which registers only range
  // and on-type formatting; turning both off leaves Prettier as the only formatter.
  defaults.setModeConfiguration({
    ...defaults.modeConfiguration,
    documentRangeFormattingEdits: false,
    onTypeFormattingEdits: false,
  });
}

export interface FormatFailure {
  message: string;
  line?: number;
}

const failureListeners = new Set<(failure: FormatFailure) => void>();
let lastFailure: FormatFailure | undefined;
let silentRuns = 0;

/** Called when formatting fails outside `formatEditor(..., { silent: true })`. */
export const onFormatFailure = (listener: (failure: FormatFailure) => void): (() => void) => {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
};

const LANGUAGES: Language[] = ["typescript", "javascript"];
for (const language of LANGUAGES) {
  monaco.languages.registerDocumentFormattingEditProvider(language, {
    displayName: "Prettier",
    async provideDocumentFormattingEdits(model) {
      const result = await formatCode(model.getValue(), language);
      if (!result.ok) {
        lastFailure = { message: result.message, line: result.line };
        if (silentRuns === 0) for (const listener of failureListeners) listener(lastFailure);
        return [];
      }
      // Monaco narrows a whole-document edit to minimal edits, so the cursor stays put.
      return [{ range: model.getFullModelRange(), text: result.code }];
    },
  });
}

/**
 * Formats through Monaco's Format Document action, so the change is one undo step.
 * Resolves with the failure, if any. `silent` suppresses the failure listeners.
 */
export const formatEditor = async (
  editor: monaco.editor.IStandaloneCodeEditor,
  { silent = false }: { silent?: boolean } = {},
): Promise<FormatFailure | undefined> => {
  lastFailure = undefined;
  if (silent) silentRuns += 1;
  try {
    await editor.getAction("editor.action.formatDocument")?.run();
  } finally {
    if (silent) silentRuns -= 1;
  }
  return lastFailure;
};

// Match the app palette in styles.css: the editor sits on --surface, with the orange accent.
monaco.editor.defineTheme("minji-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#111113",
    "editorGutter.background": "#111113",
    "editor.lineHighlightBackground": "#18181b",
    "editor.lineHighlightBorder": "#00000000",
    "editorLineNumber.foreground": "#4a4a52",
    "editorLineNumber.activeForeground": "#a1a1aa",
    "editorCursor.foreground": "#ff8a3d",
    "editor.selectionBackground": "#ff8a3d33",
    "editor.inactiveSelectionBackground": "#ff8a3d1f",
    "editorIndentGuide.background1": "#222226",
    "editorWidget.background": "#18181b",
    "editorWidget.border": "#323238",
    "scrollbarSlider.background": "#ffffff14",
    "scrollbarSlider.hoverBackground": "#ffffff24",
  },
});

monaco.editor.defineTheme("minji-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editorCursor.foreground": "#d9480f",
    "editor.selectionBackground": "#d9480f26",
    "editor.lineHighlightBorder": "#00000000",
    "editor.lineHighlightBackground": "#f7f7f5",
  },
});

export const editorTheme = (theme: "light" | "dark"): string =>
  theme === "dark" ? "minji-dark" : "minji-light";

export const EDITOR_FONT_FAMILY = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';

// Monaco measures glyphs when an editor is created; remeasure once the web font arrives.
void document.fonts.ready.then(() => monaco.editor.remeasureFonts());

export { monaco };
