import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Language } from "../runner/types.ts";
import { formatEditor, monaco, type FormatFailure } from "./monaco.ts";

export interface CodeEditorHandle {
  /** Formats with Prettier as one undo step; resolves with the failure, if any. */
  format(options?: { silent?: boolean }): Promise<FormatFailure | undefined>;
  getValue(): string;
  focus(): void;
  revealLine(line: number): void;
}

export interface EditorCommands {
  save: () => void;
  toggleStatement: () => void;
  runAll: () => void;
  runFocusedTest: () => void;
}

interface CodeEditorProps {
  workspaceId: string;
  language: Language;
  /** External changes (reset, restore, reload) are applied as undoable edits. */
  value: string;
  readOnly: boolean;
  fontSize: number;
  theme: "light" | "dark";
  onChange: (value: string) => void;
  commands: EditorCommands;
  ref?: Ref<CodeEditorHandle>;
}

const EXTENSIONS: Record<Language, string> = { typescript: "ts", javascript: "js" };

const modelUri = (workspaceId: string, language: Language): monaco.Uri =>
  monaco.Uri.parse(`file:///${workspaceId}/solution.${EXTENSIONS[language]}`);

const createModel = (text: string, workspaceId: string, language: Language) => {
  const uri = modelUri(workspaceId, language);
  monaco.editor.getModel(uri)?.dispose();
  return monaco.editor.createModel(text, language, uri);
};

/** Monaco wrapper. See specs/practice-editor.md, "Editor". */
export const CodeEditor = ({
  workspaceId,
  language,
  value,
  readOnly,
  fontSize,
  theme,
  onChange,
  commands,
  ref,
}: CodeEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // Latest callbacks, read by listeners registered once.
  const onChangeRef = useRef(onChange);
  const commandsRef = useRef(commands);
  onChangeRef.current = onChange;
  commandsRef.current = commands;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const editor = monaco.editor.create(container, {
      model: createModel(value, workspaceId, language),
      automaticLayout: true,
      fixedOverflowWidgets: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      fontSize,
      readOnly,
      ariaLabel: "Solution code",
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      commandsRef.current.save(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      commandsRef.current.runAll(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
      commandsRef.current.runFocusedTest(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, () =>
      commandsRef.current.toggleStatement(),
    );
    const changes = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });
    return () => {
      changes.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // Created once per workspace; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Switching language: new model with the same text, keeping cursor and scroll.
  useEffect(() => {
    const editor = editorRef.current;
    const current = editor?.getModel();
    if (editor === null || current === null || current === undefined) return;
    if (current.getLanguageId() === language) return;
    const viewState = editor.saveViewState();
    editor.setModel(createModel(current.getValue(), workspaceId, language));
    current.dispose();
    if (viewState !== null) editor.restoreViewState(viewState);
  }, [language, workspaceId]);

  // External value changes become one undoable edit.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model === null || model === undefined || model.getValue() === value) return;
    model.pushStackElement();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null);
    model.pushStackElement();
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, fontSize });
  }, [readOnly, fontSize]);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  useImperativeHandle(
    ref,
    () => ({
      format: (options) => {
        const editor = editorRef.current;
        return editor === null ? Promise.resolve(undefined) : formatEditor(editor, options);
      },
      getValue: () => editorRef.current?.getValue() ?? value,
      focus: () => editorRef.current?.focus(),
      revealLine: (line) => {
        const editor = editorRef.current;
        if (editor === null) return;
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      },
    }),
    [value],
  );

  return <div ref={containerRef} className="code-editor" />;
};
