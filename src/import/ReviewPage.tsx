import { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router";
import { getDatabase } from "../db/database.ts";
import type { WorkspaceBundle } from "../db/workspaces.ts";
import type {
  Language,
  CompareTarget,
  ComparisonOptions,
  NodeAdapter,
  TestKind,
} from "../runner/types.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { isValidIdentifier, newId } from "../shared/ids.ts";
import { validateTest } from "../tests/validate.ts";
import { saveImportedWorkspaces } from "../workspaces/actions.ts";
import { createWorkspace } from "../workspaces/model.ts";
import { Markdown } from "../practice/Markdown.tsx";
import { toBundle, type ExportedWorkspace } from "./exportFormat.ts";
import { argsTextFor, type DraftArg, type ImportDraft, type DraftTest } from "./parseProblem.ts";

export type ReviewEntry =
  | { kind: "problem"; draft: ImportDraft }
  | { kind: "json"; workspace: ExportedWorkspace };

interface ReviewTest {
  id: string;
  label: string;
  namedArgs: DraftArg[] | null;
  argsText: string;
  expectedText: string;
  compare: CompareTarget;
  kind?: TestKind;
  inputAdapters?: NodeAdapter[];
  outputAdapter?: NodeAdapter;
  comparison?: ComparisonOptions;
}

interface ReviewState {
  title: string;
  statement: string;
  notes: string;
  folder: string;
  tags: string[];
  language: Language;
  functionName: string;
  params: string[];
  paramsConfirmed: boolean;
  starterSource: string;
  source: string;
  tests: ReviewTest[];
  warnings: string[];
  suggestInPlace: boolean;
  inPlace: boolean;
  original: WorkspaceBundle | null;
}

const fromProblemTest = (test: DraftTest, params: string[]): ReviewTest => ({
  id: newId(),
  label: test.label,
  namedArgs: test.kind === "class" ? null : test.args,
  argsText: argsTextFor(test, params),
  expectedText: test.expectedText,
  compare: { kind: "return" },
  kind: test.kind,
});

const createReview = (entry: ReviewEntry): ReviewState => {
  if (entry.kind === "problem") {
    const { draft } = entry;
    return {
      ...draft,
      notes: "",
      folder: "",
      tags: [],
      source: draft.starterSource,
      tests: draft.tests.map((test) => fromProblemTest(test, draft.params)),
      inPlace: false,
      original: null,
    };
  }
  const original = toBundle(entry.workspace);
  const { workspace } = original;
  return {
    title: workspace.title,
    statement: workspace.statement,
    notes: workspace.notes,
    folder: workspace.folder ?? "",
    tags: workspace.tags ?? [],
    language: workspace.language,
    functionName: workspace.functionName,
    params: workspace.params,
    paramsConfirmed: true,
    starterSource: workspace.starterSource,
    source: workspace.source,
    tests: original.tests.map((test) => ({
      id: test.id,
      label: test.label,
      namedArgs: null,
      argsText: test.argsText,
      expectedText: test.expectedText,
      compare: test.compare,
      kind: test.kind,
      inputAdapters: test.inputAdapters,
      outputAdapter: test.outputAdapter,
      comparison: test.comparison,
    })),
    warnings: [],
    suggestInPlace: false,
    inPlace: false,
    original,
  };
};

const argsFor = (test: ReviewTest, params: string[]): string =>
  test.namedArgs === null
    ? test.argsText
    : argsTextFor(
        {
          label: test.label,
          args: test.namedArgs,
          expectedText: test.expectedText,
          expectedValid: true,
          kind: test.kind,
        },
        params,
      );

export const ReviewPage = ({ entry, onBack }: { entry: ReviewEntry; onBack: () => void }) => {
  const navigate = useNavigate();
  const [state, setState] = useState<ReviewState>(() => createReview(entry));
  const [editingStatement, setEditingStatement] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(false);
  const blocker = useBlocker(() => !saved.current);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!saved.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const update = (change: Partial<ReviewState>): void =>
    setState((current) => ({ ...current, ...change }));
  const updateTest = (id: string, change: Partial<ReviewTest>): void => {
    setState((current) => ({
      ...current,
      tests: current.tests.map((test) => (test.id === id ? { ...test, ...change } : test)),
    }));
  };
  const moveParam = (index: number, direction: -1 | 1): void => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.params.length) return;
    const params = [...state.params];
    [params[index], params[nextIndex]] = [params[nextIndex] ?? "", params[index] ?? ""];
    update({ params, paramsConfirmed: true });
  };
  const changeParam = (index: number, value: string): void => {
    setState((current) => {
      const oldName = current.params[index];
      const params = [...current.params];
      params[index] = value;
      return {
        ...current,
        params,
        paramsConfirmed: true,
        tests: current.tests.map((test) => ({
          ...test,
          namedArgs:
            test.namedArgs?.map((arg) => (arg.name === oldName ? { ...arg, name: value } : arg)) ??
            null,
        })),
      };
    });
  };
  const toggleInPlace = (checked: boolean): void => {
    update({
      inPlace: checked,
      tests: state.tests.map((test) => ({
        ...test,
        compare: checked ? { kind: "argument", index: 0 } : { kind: "return" },
      })),
    });
  };
  const save = async (): Promise<void> => {
    setError(null);
    if (!isValidIdentifier(state.functionName)) {
      setError("Enter a valid JavaScript function name before saving.");
      return;
    }
    if (
      state.params.some((param) => !isValidIdentifier(param)) ||
      new Set(state.params).size !== state.params.length
    ) {
      setError("Parameter names must be valid and unique.");
      return;
    }
    setSaving(true);
    try {
      const workspace =
        state.original === null
          ? createWorkspace({
              title: state.title,
              statement: state.statement,
              notes: state.notes,
              folder: state.folder,
              tags: state.tags,
              language: state.language,
              functionName: state.functionName,
              params: state.params,
              starterSource: state.starterSource,
              source: state.starterSource,
            })
          : {
              ...state.original.workspace,
              title: state.title,
              statement: state.statement,
              notes: state.notes,
              folder: state.folder,
              tags: state.tags,
              language: state.language,
              functionName: state.functionName,
              params: state.params,
              starterSource: state.starterSource,
              source: state.source,
            };
      const tests = state.tests.map((test, position) => ({
        id: test.id,
        workspaceId: workspace.id,
        position,
        label: test.label,
        argsText: argsFor(test, state.params),
        expectedText: test.expectedText,
        compare: test.compare,
        kind: test.kind,
        inputAdapters: test.inputAdapters,
        outputAdapter: test.outputAdapter,
        comparison: test.comparison,
      }));
      await saveImportedWorkspaces(await getDatabase(), [
        {
          workspace,
          tests,
          revisions: state.original?.revisions ?? [],
        },
      ]);
      saved.current = true;
      await navigate(`/w/${workspace.id}`);
    } catch {
      setError("The workspace couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const cannotSave =
    saving ||
    [state.title, state.statement, state.starterSource].every((value) => value.trim() === "");
  const showConfirm = discarding || blocker.state === "blocked";

  return (
    <main className="page import-page">
      <div className="page-heading">
        <h1>Review import</h1>
        <button type="button" className="button" onClick={() => setDiscarding(true)}>
          Back
        </button>
      </div>
      {state.warnings.length > 0 ? (
        <div className="notice" role="status">
          <ul className="import-warnings">
            {state.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error === null ? null : (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <section className="import-form" aria-label="Workspace fields">
        <label className="field">
          <span className="field-label">Title</span>
          <input value={state.title} onChange={(event) => update({ title: event.target.value })} />
        </label>
        <div className="import-field-grid">
          <label className="field">
            <span className="field-label">Language</span>
            <select
              value={state.language}
              onChange={(event) => update({ language: event.target.value as Language })}
            >
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Function name</span>
            <input
              value={state.functionName}
              onChange={(event) => update({ functionName: event.target.value })}
              aria-invalid={!isValidIdentifier(state.functionName)}
            />
          </label>
        </div>
        <div className="field">
          <span className="field-label">Parameters, in call order</span>
          <div className="param-list">
            {state.params.map((param, index) => (
              // Parameters can be renamed, so their position is the stable identity here.
              // oxlint-disable-next-line react/no-array-index-key
              <div className="param-chip" key={index}>
                <input
                  aria-label={`Parameter ${index + 1}`}
                  value={param}
                  onChange={(event) => changeParam(index, event.target.value)}
                />
                <button
                  type="button"
                  className="button button-small"
                  aria-label={`Move ${param} left`}
                  disabled={index === 0}
                  onClick={() => moveParam(index, -1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="button button-small"
                  aria-label={`Move ${param} right`}
                  disabled={index === state.params.length - 1}
                  onClick={() => moveParam(index, 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  className="button button-small"
                  aria-label={`Remove ${param}`}
                  onClick={() =>
                    update({
                      params: state.params.filter((_, position) => position !== index),
                      paramsConfirmed: true,
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button button-small"
              onClick={() =>
                update({
                  params: [...state.params, `arg${state.params.length + 1}`],
                  paramsConfirmed: true,
                })
              }
            >
              Add parameter
            </button>
          </div>
          {!state.paramsConfirmed ? (
            <label className="notice">
              <span>Check the parameter order; it was guessed from the examples.</span>
              <span>
                <input
                  type="checkbox"
                  onChange={(event) => update({ paramsConfirmed: event.target.checked })}
                />{" "}
                Order is correct
              </span>
            </label>
          ) : null}
        </div>
        <section className="field" aria-label="Statement">
          <div className="import-section-heading">
            <span className="field-label">Statement</span>
            <button
              type="button"
              className="button button-small"
              onClick={() => setEditingStatement((value) => !value)}
            >
              {editingStatement ? "Preview" : "Edit raw"}
            </button>
          </div>
          {editingStatement ? (
            <textarea
              value={state.statement}
              onChange={(event) => update({ statement: event.target.value })}
              rows={12}
              aria-label="Statement raw text"
            />
          ) : (
            <div className="prose-block">
              <Markdown text={state.statement} />
            </div>
          )}
        </section>
        {state.original === null ? null : (
          <label className="field">
            <span className="field-label">Notes</span>
            <textarea
              value={state.notes}
              onChange={(event) => update({ notes: event.target.value })}
              rows={4}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">Starter code</span>
          <textarea
            className="code-input"
            value={state.starterSource}
            onChange={(event) => update({ starterSource: event.target.value })}
            rows={8}
          />
        </label>
        {state.original === null ? null : (
          <label className="field">
            <span className="field-label">Current code</span>
            <textarea
              className="code-input"
              value={state.source}
              onChange={(event) => update({ source: event.target.value })}
              rows={8}
            />
          </label>
        )}
      </section>
      {state.suggestInPlace ? (
        <label className="notice">
          <input
            type="checkbox"
            checked={state.inPlace}
            onChange={(event) => toggleInPlace(event.target.checked)}
          />{" "}
          This looks like an in-place problem. Compare argument 1 ({state.params[0] ?? "input"})
          after the call?
        </label>
      ) : null}
      <section className="import-form" aria-label="Imported tests">
        <h2>Tests ({state.tests.length})</h2>
        {state.tests.length === 0 ? (
          <p className="hint">No examples were found. You can add tests in the workspace.</p>
        ) : (
          <ol className="test-rows">
            {state.tests.map((test) => {
              const argsText = argsFor(test, state.params);
              const validation = validateTest(
                {
                  argsText,
                  expectedText: test.expectedText,
                  compare: test.compare,
                  kind: test.kind,
                  inputAdapters: test.inputAdapters,
                  outputAdapter: test.outputAdapter,
                  comparison: test.comparison,
                },
                state.params,
                state.functionName,
              );
              return (
                <li className="test-row" key={test.id}>
                  <div className="test-row-header">
                    <input
                      className="test-label"
                      aria-label="Test label"
                      value={test.label}
                      onChange={(event) => updateTest(test.id, { label: event.target.value })}
                    />
                    <span className={validation.valid ? "import-valid" : "field-error"}>
                      {validation.valid ? "Valid" : "Invalid"}
                    </span>
                  </div>
                  <div className="import-field-grid">
                    <label className="field">
                      <span className="field-label">Arguments (JSON array)</span>
                      <textarea
                        className="json-input"
                        value={argsText}
                        aria-invalid={validation.args !== undefined}
                        onChange={(event) =>
                          updateTest(test.id, { argsText: event.target.value, namedArgs: null })
                        }
                      />
                      {validation.args === undefined ? null : (
                        <span className="field-error">{validation.args}</span>
                      )}
                    </label>
                    <label className="field">
                      <span className="field-label">Expected (JSON)</span>
                      <textarea
                        className="json-input"
                        value={test.expectedText}
                        aria-invalid={validation.expected !== undefined}
                        onChange={(event) =>
                          updateTest(test.id, { expectedText: event.target.value })
                        }
                      />
                      {validation.expected === undefined ? null : (
                        <span className="field-error">{validation.expected}</span>
                      )}
                    </label>
                  </div>
                  {validation.warning === undefined ? null : (
                    <p className="hint">{validation.warning}</p>
                  )}
                  <label className="field">
                    <span className="field-label">Compare</span>
                    <select
                      value={test.compare.kind === "return" ? "return" : "argument"}
                      onChange={(event) =>
                        updateTest(test.id, {
                          compare:
                            event.target.value === "return"
                              ? { kind: "return" }
                              : { kind: "argument", index: 0 },
                        })
                      }
                    >
                      <option value="return">Return value</option>
                      <option value="argument">Argument 1 after call</option>
                    </select>
                  </label>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          disabled={cannotSave}
          onClick={() => void save()}
        >
          Save workspace
        </button>
      </div>
      <ConfirmDialog
        open={showConfirm}
        title="Discard import draft?"
        confirmLabel="Discard"
        danger
        onCancel={() => {
          setDiscarding(false);
          if (blocker.state === "blocked") blocker.reset();
        }}
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
          else onBack();
        }}
      >
        Your review changes will be lost.
      </ConfirmDialog>
    </main>
  );
};
