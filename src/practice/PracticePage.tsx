import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getDatabase } from "../db/database.ts";
import {
  addRevision,
  getBundle,
  getRevisions,
  saveDraft,
  type WorkspaceBundle,
  type WorkspaceEdit,
} from "../db/workspaces.ts";
import type { Language } from "../runner/types.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { postChannelMessage, subscribeToChannel } from "../shared/channel.ts";
import { newId } from "../shared/ids.ts";
import { AUTOSAVE_DEBOUNCE_MS } from "../shared/limits.ts";
import { useToast } from "../shared/toast.tsx";
import { useMediaQuery } from "../shared/useMediaQuery.ts";
import { ConsolePanel, ResultsPanel } from "../tests/ResultsPanel.tsx";
import type { RunScope } from "../tests/results.ts";
import { TestList } from "../tests/TestList.tsx";
import { exportWorkspaces } from "../workspaces/actions.ts";
import { scratchStub, type Revision, type TestCase, type Workspace } from "../workspaces/model.ts";
import { createAutosaver, type SaveStatus } from "./autosave.ts";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor.tsx";
import { HistoryDialog } from "./HistoryDialog.tsx";
import { onFormatFailure, type FormatFailure } from "./monaco.ts";
import { rememberLanguage, useEditorSettings } from "./settings.ts";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { StatementPanel } from "./StatementPanel.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { useTestRun } from "./useTestRun.ts";
import { useWorkspaceLock } from "./useWorkspaceLock.ts";

export const practiceLoader = async ({ params }: LoaderFunctionArgs) => {
  const bundle =
    params.id === undefined ? undefined : await getBundle(await getDatabase(), params.id);
  return { bundle: bundle ?? null };
};

interface Draft {
  edit: WorkspaceEdit;
  tests?: TestCase[];
}

type Dialog = "reset" | "history" | "shortcuts" | null;
type BottomTab = "tests" | "results" | "console";
type PhoneTab = "statement" | "code" | "tests" | "results";

const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform);

const failureText = (prefix: string, failure: FormatFailure): string =>
  failure.line === undefined
    ? `${prefix}: ${failure.message}`
    : `${prefix}: syntax error on line ${failure.line}.`;

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, .monaco-editor") !== null);

interface TabsProps<T extends string> {
  label: string;
  tabs: { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
}

const Tabs = <T extends string>({ label, tabs, selected, onSelect }: TabsProps<T>) => (
  <div role="tablist" aria-label={label} className="tabs">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={tab.id === selected}
        tabIndex={tab.id === selected ? 0 : -1}
        className="tab"
        onClick={() => onSelect(tab.id)}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
  { id: "tests", label: "Tests" },
  { id: "results", label: "Results" },
  { id: "console", label: "Console" },
];

const PHONE_TABS: { id: PhoneTab; label: string }[] = [
  { id: "statement", label: "Statement" },
  { id: "code", label: "Code" },
  { id: "tests", label: "Tests" },
  { id: "results", label: "Results" },
];

interface DesktopLayoutProps {
  statementPanelRef: RefObject<PanelImperativeHandle | null>;
  collapseStatementByDefault: boolean;
  statement: ReactNode;
  editor: ReactNode;
  bottom: ReactNode;
}

const DesktopLayout = ({
  statementPanelRef,
  collapseStatementByDefault,
  statement,
  editor,
  bottom,
}: DesktopLayoutProps) => {
  const storage = typeof localStorage === "undefined" ? undefined : localStorage;
  const main = useDefaultLayout({ id: "minji:layout:v1:main", storage });
  const work = useDefaultLayout({ id: "minji:layout:v1:work", storage });

  return (
    <Group
      orientation="horizontal"
      className="practice-panels"
      defaultLayout={main.defaultLayout}
      onLayoutChanged={main.onLayoutChanged}
    >
      <Panel
        id="statement"
        panelRef={statementPanelRef}
        // Without a saved layout, narrow windows start with the statement collapsed.
        defaultSize={collapseStatementByDefault ? "0" : "30"}
        minSize="15"
        collapsible
        collapsedSize="0"
      >
        {statement}
      </Panel>
      <Separator className="separator" aria-label="Resize statement panel" />
      <Panel id="work" minSize="35">
        <Group
          orientation="vertical"
          className="practice-work"
          defaultLayout={work.defaultLayout}
          onLayoutChanged={work.onLayoutChanged}
        >
          <Panel id="editor" defaultSize="60" minSize="20">
            {editor}
          </Panel>
          <Separator className="separator separator-horizontal" aria-label="Resize tests panel" />
          <Panel id="bottom" defaultSize="40" minSize="15">
            {bottom}
          </Panel>
        </Group>
      </Panel>
    </Group>
  );
};

interface PracticeProps {
  initial: WorkspaceBundle;
}

const Practice = ({ initial }: PracticeProps) => {
  const id = initial.workspace.id;
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const [tests, setTests] = useState<TestCase[]>(initial.tests);
  const [revisions, setRevisions] = useState<Revision[]>(initial.revisions);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [bottomTab, setBottomTab] = useState<BottomTab>("tests");
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("code");
  const settings = useEditorSettings();
  const showToast = useToast();
  const editorRef = useRef<CodeEditorHandle>(null);
  const statementPanelRef = usePanelRef();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const isNarrow = useMediaQuery("(max-width: 1023px)");
  const latest = useRef({ workspace, tests });
  latest.current = { workspace, tests };

  const autosaver = useMemo(
    () =>
      createAutosaver<Draft>({
        save: async ({ edit, tests: draftTests }) => {
          const saved = await saveDraft(await getDatabase(), id, edit, draftTests);
          if (saved !== undefined) postChannelMessage({ type: "changed", id });
        },
        merge: (older, newer) => ({
          edit: { ...older.edit, ...newer.edit },
          tests: newer.tests ?? older.tests,
        }),
        delayMs: AUTOSAVE_DEBOUNCE_MS,
        onStatus: setSaveStatus,
      }),
    [id],
  );

  const reload = useCallback(async () => {
    const bundle = await getBundle(await getDatabase(), id);
    if (bundle === undefined) return;
    setWorkspace(bundle.workspace);
    setTests(bundle.tests);
    setRevisions(bundle.revisions);
  }, [id]);

  const lock = useWorkspaceLock(id, {
    beforeRelease: () => autosaver.flush(),
    afterTakeOver: reload,
  });
  const readOnly = lock.state !== "held";

  // Flush when leaving the route or hiding the tab; warn before closing with unsaved work.
  useEffect(() => {
    const flush = (): void => void autosaver.flush();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (autosaver.hasPending()) event.preventDefault();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Flush only: React may remount this component (StrictMode), and the same
      // autosaver must keep working afterwards.
      void autosaver.flush();
    };
  }, [autosaver]);

  // A read-only tab follows changes saved by the tab that holds the lock.
  useEffect(() => {
    if (!readOnly) return undefined;
    return subscribeToChannel((message) => {
      if (message.type === "changed" && message.id === id) void reload();
    });
  }, [readOnly, id, reload]);

  useEffect(
    () =>
      onFormatFailure((failure) => showToast({ message: failureText("Couldn't format", failure) })),
    [showToast],
  );

  const edit = useCallback(
    (change: WorkspaceEdit) => {
      if (readOnly) return;
      setWorkspace((current) => ({ ...current, ...change }));
      autosaver.schedule({ edit: change });
    },
    [readOnly, autosaver],
  );

  const changeTests = useCallback(
    (next: TestCase[]) => {
      if (readOnly) return;
      setTests(next);
      autosaver.schedule({ edit: {}, tests: next });
    },
    [readOnly, autosaver],
  );

  const changeFunctionName = (name: string): void => {
    const current = latest.current.workspace;
    if (current.source === current.starterSource) {
      const stub = scratchStub(name, current.params);
      edit({ functionName: name, source: stub, starterSource: stub });
    } else {
      edit({ functionName: name });
    }
  };

  const changeLanguage = (language: Language): void => {
    rememberLanguage(language);
    edit({ language });
  };

  /** Snapshot of the current code in History. */
  const snapshot = async (reason: Revision["reason"]): Promise<{ added: boolean; id: string }> => {
    const { workspace: current } = latest.current;
    const db = await getDatabase();
    const result = await addRevision(db, {
      id: newId(),
      workspaceId: id,
      language: current.language,
      source: editorRef.current?.getValue() ?? current.source,
      reason,
      createdAt: new Date().toISOString(),
      synced: false,
    });
    setRevisions(await getRevisions(db, id));
    return result;
  };

  const saveRevision = async (): Promise<void> => {
    if (readOnly) return;
    const failure = settings.formatOnSave
      ? await editorRef.current?.format({ silent: true })
      : undefined;
    await autosaver.flush();
    const { added } = await snapshot("save");
    if (failure !== undefined) {
      showToast({ message: failureText("Saved without formatting", failure) });
    } else {
      showToast({ message: added ? "Revision saved" : "No changes since the last revision." });
    }
  };

  const testRun = useTestRun({
    // The editor's text is read directly, in case a keystroke hasn't re-rendered yet.
    getState: () => ({
      workspace: {
        ...latest.current.workspace,
        source: editorRef.current?.getValue() ?? latest.current.workspace.source,
      },
      tests: latest.current.tests,
    }),
    beforeRun: async () => {
      await autosaver.flush();
      if (readOnly) return null;
      const { id: revisionId } = await snapshot("run");
      return revisionId;
    },
    onLastRun: (lastRun) => setWorkspace((current) => ({ ...current, lastRun })),
  });
  const lastSingleTest = useRef<string | null>(null);

  const startRun = (scope: RunScope): void => {
    if (scope.kind === "single") lastSingleTest.current = scope.testId;
    setBottomTab("results");
    setPhoneTab("results");
    void testRun.run(scope);
  };

  /** Runs the test row that has focus, or else the last test run on its own. */
  const runFocusedTest = (): void => {
    const row = document.activeElement?.closest<HTMLElement>("[data-test-id]");
    const testId = row?.dataset.testId ?? lastSingleTest.current;
    if (testId !== null && testId !== undefined) startRun({ kind: "single", testId });
  };

  const goToLine = (line: number): void => {
    setPhoneTab("code");
    editorRef.current?.revealLine(line);
  };

  const toggleStatement = (): void => {
    const panel = statementPanelRef.current;
    if (panel === null) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  const restore = async (revision: Revision): Promise<void> => {
    const before = {
      source: latest.current.workspace.source,
      language: latest.current.workspace.language,
    };
    await snapshot("save");
    edit({ source: revision.source, language: revision.language });
    setDialog(null);
    showToast({
      message: "Revision restored.",
      action: { label: "Undo", onClick: () => edit(before) },
    });
  };

  const reset = async (): Promise<void> => {
    setDialog(null);
    await snapshot("save");
    edit({ source: latest.current.workspace.starterSource });
  };

  const exportCurrent = async (): Promise<void> => {
    await autosaver.flush();
    await exportWorkspaces(await getDatabase(), [id]);
  };

  // Shortcuts that also work outside the editor. Monaco handles its own copies and
  // marks those events as handled.
  const shortcuts = useRef({ saveRevision, toggleStatement, startRun, runFocusedTest });
  shortcuts.current = { saveRevision, toggleStatement, startRun, runFocusedTest };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const mod = isMacPlatform ? event.metaKey : event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void shortcuts.current.saveRevision();
      } else if (mod && event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) shortcuts.current.runFocusedTest();
        else shortcuts.current.startRun({ kind: "all" });
      } else if (mod && event.key === "\\") {
        event.preventDefault();
        shortcuts.current.toggleStatement();
      } else if (event.key === "?" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setDialog("shortcuts");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const statement = (
    <StatementPanel
      statement={workspace.statement}
      notes={workspace.notes}
      readOnly={readOnly}
      onStatementChange={(text) => edit({ statement: text })}
      onNotesChange={(text) => edit({ notes: text })}
    />
  );

  const editor = (
    <div className="editor-panel">
      <CodeEditor
        ref={editorRef}
        workspaceId={id}
        language={workspace.language}
        value={workspace.source}
        readOnly={readOnly || isPhone}
        fontSize={settings.fontSize}
        theme={settings.resolvedTheme}
        onChange={(source) => edit({ source })}
        commands={{
          save: () => void saveRevision(),
          toggleStatement,
          runAll: () => startRun({ kind: "all" }),
          runFocusedTest,
        }}
      />
    </div>
  );

  const testList = (
    <TestList
      workspaceId={id}
      tests={tests}
      params={workspace.params}
      readOnly={readOnly}
      running={testRun.running}
      onChange={changeTests}
      onRunTest={(testId) => startRun({ kind: "single", testId })}
    />
  );

  const results = (
    <ResultsPanel
      view={testRun.view}
      functionName={workspace.functionName}
      timeoutMs={workspace.testTimeoutMs}
      onGoToLine={goToLine}
    />
  );

  const bottom = (
    <section className="panel" aria-label="Tests, results and console">
      <div className="panel-header">
        <Tabs
          label="Tests, results and console"
          tabs={BOTTOM_TABS}
          selected={bottomTab}
          onSelect={setBottomTab}
        />
      </div>
      <div className="panel-body">
        {bottomTab === "tests" ? testList : null}
        {bottomTab === "results" ? results : null}
        {bottomTab === "console" ? <ConsolePanel view={testRun.view} /> : null}
      </div>
    </section>
  );

  return (
    <main className="practice">
      <h1 className="visually-hidden">
        {workspace.title.trim() === "" ? "Untitled" : workspace.title}
      </h1>
      <Toolbar
        workspace={workspace}
        readOnly={readOnly}
        saveStatus={saveStatus}
        settings={settings}
        running={testRun.running}
        onRunAll={() => startRun({ kind: "all" })}
        onStop={testRun.stop}
        onTitleChange={(title) => edit({ title })}
        onLanguageChange={changeLanguage}
        onFunctionNameChange={changeFunctionName}
        onTimeoutChange={(testTimeoutMs) => edit({ testTimeoutMs })}
        onRetrySave={() => void autosaver.flush()}
        onReset={() => setDialog("reset")}
        onFormat={() => void editorRef.current?.format()}
        onHistory={() => setDialog("history")}
        onExport={() => void exportCurrent()}
        onShortcuts={() => setDialog("shortcuts")}
      />
      {lock.state === "read-only" ? (
        <div className="notice" role="status">
          <p>This workspace is open in another tab.</p>
          <button type="button" className="button" onClick={lock.takeOver}>
            Take over
          </button>
        </div>
      ) : null}
      {isPhone ? (
        <div className="phone-layout">
          <Tabs
            label="Workspace sections"
            tabs={PHONE_TABS}
            selected={phoneTab}
            onSelect={setPhoneTab}
          />
          <div className="phone-body">
            {phoneTab === "statement" ? statement : null}
            {phoneTab === "code" ? editor : null}
            {phoneTab === "tests" ? <div className="panel-body">{testList}</div> : null}
            {phoneTab === "results" ? <div className="panel-body">{results}</div> : null}
          </div>
        </div>
      ) : (
        <DesktopLayout
          statementPanelRef={statementPanelRef}
          collapseStatementByDefault={isNarrow}
          statement={statement}
          editor={editor}
          bottom={bottom}
        />
      )}

      <ConfirmDialog
        open={dialog === "reset"}
        title="Reset code?"
        confirmLabel="Reset"
        danger
        onConfirm={() => void reset()}
        onCancel={() => setDialog(null)}
      >
        <p>Replace your code with the starter code? Your current code is saved to History first.</p>
      </ConfirmDialog>
      <HistoryDialog
        open={dialog === "history"}
        revisions={revisions}
        currentSource={workspace.source}
        theme={settings.resolvedTheme}
        readOnly={readOnly}
        onRestore={(revision) => void restore(revision)}
        onClose={() => setDialog(null)}
      />
      <ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
    </main>
  );
};

/** The practice screen. See specs/practice-editor.md. */
export const PracticePage = () => {
  const { bundle } = useLoaderData<typeof practiceLoader>();

  if (bundle === null) {
    return (
      <main className="page">
        <h1>Workspace not found</h1>
        <p className="page-intro">This workspace doesn't exist or was deleted.</p>
        <p>
          <Link to="/">Back to my workspaces</Link>
        </p>
      </main>
    );
  }

  return <Practice key={bundle.workspace.id} initial={bundle} />;
};
