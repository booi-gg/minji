import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { SquareCheck, SquareTerminal, type LucideIcon } from "lucide-react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { getDatabase, type ConflictRecord } from "../db/database.ts";
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
import { useSync } from "../sync/SyncProvider.tsx";
import { getConflict, keepBoth, keepTheirs, prepareKeepMine } from "../sync/store.ts";
import { ResultsPanel } from "../tests/ResultsPanel.tsx";
import type { RunScope } from "../tests/results.ts";
import { TestList } from "../tests/TestList.tsx";
import { exportWorkspaces } from "../workspaces/actions.ts";
import { scratchStub, type Revision, type TestCase, type Workspace } from "../workspaces/model.ts";
import { createAutosaver, type SaveStatus } from "./autosave.ts";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor.tsx";
import { entryPointFromSource } from "./entryPoint.ts";
import { ConflictDialog } from "./ConflictDialog.tsx";
import { HistoryDialog } from "./HistoryDialog.tsx";
import { onFormatFailure, type FormatFailure } from "./monaco.ts";
import { rememberLanguage, useEditorSettings } from "./settings.ts";
import { ProblemSidebar } from "./ProblemSidebar.tsx";
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
type BottomTab = "tests" | "results";
type PhoneTab = "statement" | "code" | "tests" | "results";

const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform);

const failureText = (prefix: string, failure: FormatFailure): string =>
  failure.line === undefined
    ? `${prefix}: ${failure.message}`
    : `${prefix}: syntax error on line ${failure.line}.`;

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, .monaco-editor") !== null);

interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface TabsProps<T extends string> {
  label: string;
  tabs: TabItem<T>[];
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
        {tab.icon === undefined ? null : (
          <tab.icon size={16} className={`tab-icon tab-icon-${tab.id}`} aria-hidden="true" />
        )}
        {tab.label}
      </button>
    ))}
  </div>
);

const BOTTOM_TABS: TabItem<BottomTab>[] = [
  { id: "tests", label: "Testcase", icon: SquareCheck },
  { id: "results", label: "Test Result", icon: SquareTerminal },
];

const PHONE_TABS: TabItem<PhoneTab>[] = [
  { id: "statement", label: "Statement" },
  { id: "code", label: "Code" },
  { id: "tests", label: "Testcase", icon: SquareCheck },
  { id: "results", label: "Result", icon: SquareTerminal },
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
  /** `null` where there's no room for the sidebar (phones). */
  sidebarOpen: boolean | null;
  onToggleSidebar: () => void;
}

const Practice = ({ initial, sidebarOpen, onToggleSidebar }: PracticeProps) => {
  const id = initial.workspace.id;
  const navigate = useNavigate();
  const { account, sync } = useSync();
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const [tests, setTests] = useState<TestCase[]>(initial.tests);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(initial.tests[0]?.id ?? null);
  const [revisions, setRevisions] = useState<Revision[]>(initial.revisions);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [conflict, setConflict] = useState<ConflictRecord | null>(null);
  const [comparing, setComparing] = useState(false);
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

  useEffect(() => {
    void getDatabase().then(async (db) => setConflict((await getConflict(db, id)) ?? null));
    return subscribeToChannel((message) => {
      if (message.type !== "changed" || message.id !== id) return;
      void (async () => {
        const db = await getDatabase();
        const stored = await db.get("workspaces", id);
        if (stored === undefined || stored.deletedAt !== null) {
          showToast({ message: "This problem was deleted on another device." });
          await navigate("/");
          return;
        }
        setConflict((await getConflict(db, id)) ?? null);
        if (!autosaver.hasPending()) await reload();
      })();
    });
  }, [id, reload, autosaver, navigate, showToast]);

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
    const generatedStub = scratchStub(current.functionName, current.params);
    if (current.source === current.starterSource && current.starterSource === generatedStub) {
      const stub = scratchStub(name, current.params);
      edit({ functionName: name, source: stub, starterSource: stub });
    } else {
      edit({ functionName: name });
    }
  };

  const sourceEdit = (source: string): WorkspaceEdit => {
    const current = latest.current.workspace;
    const entryPoint = entryPointFromSource(source, current.functionName);
    if (entryPoint === undefined) return { source };
    const paramsChanged =
      entryPoint.params.length !== current.params.length ||
      entryPoint.params.some((param, index) => param !== current.params[index]);
    return entryPoint.name === current.functionName && !paramsChanged
      ? { source }
      : { source, functionName: entryPoint.name, params: entryPoint.params };
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
    postChannelMessage({ type: "sync-request" });
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
        ...sourceEdit(editorRef.current?.getValue() ?? latest.current.workspace.source),
      },
      tests: latest.current.tests,
    }),
    beforeRun: async () => {
      await autosaver.flush();
      if (readOnly) return null;
      const { id: revisionId } = await snapshot("run");
      postChannelMessage({ type: "sync-request" });
      return revisionId;
    },
    onLastRun: (lastRun) => setWorkspace((current) => ({ ...current, lastRun })),
  });
  const lastSingleTest = useRef<string | null>(null);

  const startRun = (scope: RunScope): void => {
    if (scope.kind === "single") {
      lastSingleTest.current = scope.testId;
      setSelectedTestId(scope.testId);
    }
    setBottomTab("results");
    setPhoneTab("results");
    void testRun.run(scope);
  };

  /** Runs the focused case, or the selected case when focus is elsewhere. */
  const runFocusedTest = (): void => {
    const row = document.activeElement?.closest<HTMLElement>("[data-test-id]");
    const testId = row?.dataset.testId ?? selectedTestId ?? lastSingleTest.current;
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
    edit({ ...sourceEdit(revision.source), language: revision.language });
    setDialog(null);
    showToast({
      message: "Revision restored.",
      action: { label: "Undo", onClick: () => edit(before) },
    });
  };

  const reset = async (): Promise<void> => {
    setDialog(null);
    await snapshot("save");
    edit(sourceEdit(latest.current.workspace.starterSource));
  };

  const exportCurrent = async (): Promise<void> => {
    await autosaver.flush();
    await exportWorkspaces(await getDatabase(), [id]);
  };

  const resolveConflict = async (choice: "mine" | "theirs" | "both"): Promise<void> => {
    if (account === null || conflict === null) return;
    await autosaver.flush();
    const db = await getDatabase();
    if (choice === "mine") {
      const result = await prepareKeepMine(db, id, account.id);
      setConflict(null);
      if (result?.id !== id && result !== undefined) await navigate(`/w/${result.id}`);
      else await reload();
      sync();
    } else if (choice === "theirs") {
      await keepTheirs(db, id, account.id);
      setConflict(null);
      if (conflict.deleted) await navigate("/");
      else await reload();
    } else {
      const copyId = await keepBoth(db, id, account.id);
      setConflict(null);
      if (copyId !== undefined) await navigate(`/w/${copyId}`);
      sync();
    }
    postChannelMessage({ type: "changed", id });
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
        onChange={(source) => edit(sourceEdit(source))}
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
      functionName={workspace.functionName}
      readOnly={readOnly}
      selectedId={selectedTestId}
      onSelect={setSelectedTestId}
      onChange={changeTests}
    />
  );

  const results = (
    <ResultsPanel
      view={testRun.view}
      functionName={workspace.functionName}
      timeoutMs={workspace.testTimeoutMs}
      params={workspace.params}
      selectedId={selectedTestId}
      onSelect={setSelectedTestId}
      onGoToLine={goToLine}
    />
  );

  const bottom = (
    <section className="panel" aria-label="Testcase and test result">
      <div className="panel-header">
        <Tabs
          label="Testcase and test result"
          tabs={BOTTOM_TABS}
          selected={bottomTab}
          onSelect={setBottomTab}
        />
      </div>
      <div className="panel-body">
        {bottomTab === "tests" ? testList : null}
        {bottomTab === "results" ? results : null}
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
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        readOnly={readOnly}
        saveStatus={saveStatus}
        settings={settings}
        running={testRun.running}
        onRunAll={() => startRun({ kind: "all" })}
        onStop={testRun.stop}
        onTitleChange={(title) => edit({ title })}
        onLanguageChange={changeLanguage}
        onDifficultyChange={(difficulty) => edit({ difficulty })}
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
          <p>This problem is open in another tab.</p>
          <button type="button" className="button" onClick={lock.takeOver}>
            Take over
          </button>
        </div>
      ) : null}
      {conflict === null ? null : (
        <div className="notice" role="status">
          <p>This problem changed on another device.</p>
          <div className="actions">
            <button type="button" className="button" onClick={() => setComparing(true)}>
              Compare
            </button>
            <button type="button" className="button" onClick={() => void resolveConflict("mine")}>
              Keep mine
            </button>
            <button type="button" className="button" onClick={() => void resolveConflict("theirs")}>
              Keep theirs
            </button>
            <button type="button" className="button" onClick={() => void resolveConflict("both")}>
              Keep both
            </button>
          </div>
        </div>
      )}
      {isPhone ? (
        <div className="phone-layout">
          <Tabs
            label="Problem sections"
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
      <ConflictDialog
        open={comparing}
        conflict={conflict}
        workspace={workspace}
        tests={tests}
        theme={settings.resolvedTheme}
        onClose={() => setComparing(false)}
      />
      <ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
    </main>
  );
};

const SIDEBAR_KEY = "minji:sidebar";

const readSidebarOpen = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
};

/** The practice screen. See specs/practice-editor.md. */
export const PracticePage = () => {
  const { bundle } = useLoaderData<typeof practiceLoader>();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);

  const toggleSidebar = (): void => {
    setSidebarOpen((open) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, open ? "closed" : "open");
      } catch {
        // Storage can be unavailable; the toggle still works for this visit.
      }
      return !open;
    });
  };

  if (bundle === null) {
    return (
      <main className="page">
        <h1>Problem not found</h1>
        <p className="page-intro">This problem doesn't exist or was deleted.</p>
        <p>
          <Link to="/">Back to my problems</Link>
        </p>
      </main>
    );
  }

  // The sidebar sits outside the keyed Practice, so switching problems keeps its list and scroll.
  return (
    <div className="practice-shell">
      {sidebarOpen && !isPhone ? <ProblemSidebar activeId={bundle.workspace.id} /> : null}
      <Practice
        key={bundle.workspace.id}
        initial={bundle}
        sidebarOpen={isPhone ? null : sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
    </div>
  );
};
