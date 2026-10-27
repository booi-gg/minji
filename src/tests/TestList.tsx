import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { CompareTarget } from "../runner/types.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { newId } from "../shared/ids.ts";
import { MAX_TESTS_PER_WORKSPACE } from "../shared/limits.ts";
import { useToast } from "../shared/toast.tsx";
import type { TestCase } from "../workspaces/model.ts";
import { validateTest, type TestValidation } from "./validate.ts";

const LARGE_TEXT_CHARS = 100_000;
const VALIDATION_DELAY_MS = 300;

const formatSize = (chars: number): string => `${(chars / 1_000_000).toFixed(1)} MB`;

/** Shows validation 300 ms after typing stops, so half-typed JSON isn't flagged at once. */
const useSettled = <T,>(value: T): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), VALIDATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
};

const compareValue = (compare: CompareTarget): string =>
  compare.kind === "return" ? "return" : `argument-${compare.index}`;

const parseCompare = (value: string): CompareTarget => {
  const index = Number(value.replace("argument-", ""));
  return value === "return" || !Number.isInteger(index)
    ? { kind: "return" }
    : { kind: "argument", index };
};

interface JsonFieldProps {
  label: string;
  hint?: string;
  value: string;
  error?: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

const JsonField = ({
  label,
  hint,
  value,
  error,
  readOnly,
  onChange,
  autoFocus,
}: JsonFieldProps) => {
  const id = useId();
  const [editingLarge, setEditingLarge] = useState(false);
  const [draft, setDraft] = useState(value);
  const [touched, setTouched] = useState(false);
  const large = value.length > LARGE_TEXT_CHARS;
  // An empty field isn't flagged until it has been left once.
  const shownError = touched || value.trim() !== "" ? error : undefined;

  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
        {hint === undefined ? null : <span className="hint"> {hint}</span>}
      </label>
      {large ? (
        <div className="large-input">
          <span id={id}>Large input · {formatSize(value.length)}</span>
          {readOnly ? null : (
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setDraft(value);
                setEditingLarge(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
      ) : (
        <textarea
          id={id}
          className="json-input"
          spellCheck={false}
          rows={1}
          value={value}
          readOnly={readOnly}
          aria-invalid={shownError !== undefined}
          aria-describedby={shownError === undefined ? undefined : `${id}-error`}
          autoFocus={autoFocus}
          // A new test's placeholder `[]` is selected, so typing replaces it.
          onFocus={autoFocus ? (event) => event.currentTarget.select() : undefined}
          onBlur={() => setTouched(true)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {shownError === undefined ? null : (
        <p id={`${id}-error`} className="field-error">
          {shownError}
        </p>
      )}
      <ConfirmDialog
        open={editingLarge}
        title={`Edit ${label.toLowerCase()}`}
        confirmLabel="Done"
        onConfirm={() => {
          onChange(draft);
          setEditingLarge(false);
        }}
        onCancel={() => setEditingLarge(false)}
      >
        <textarea
          className="json-input json-input-large"
          aria-label={label}
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
};

interface TestRowProps {
  test: TestCase;
  index: number;
  count: number;
  params: readonly string[];
  readOnly: boolean;
  running: boolean;
  autoFocus: boolean;
  onChange: (test: TestCase) => void;
  onRun: (testId: string) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
}

const TestRow = ({
  test,
  index,
  count,
  params,
  readOnly,
  running,
  autoFocus,
  onChange,
  onRun,
  onMove,
  onDuplicate,
  onDelete,
}: TestRowProps) => {
  const compareId = useId();
  const labelId = useId();
  const current = useMemo(
    () => validateTest(test, params),
    [test.argsText, test.expectedText, test.compare, params],
  );
  const validation: TestValidation = useSettled(current);
  const name = test.label === "" ? `Test ${index + 1}` : test.label;
  const argCount = current.argCount ?? params.length;

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (readOnly || !event.altKey) return;
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onMove(index, index - 1);
    } else if (event.key === "ArrowDown" && index < count - 1) {
      event.preventDefault();
      onMove(index, index + 1);
    }
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>): void => {
    event.dataTransfer.setData("text/x-minji-test", String(index));
    event.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (event: DragEvent<HTMLLIElement>): void => {
    const from = Number(event.dataTransfer.getData("text/x-minji-test"));
    if (!Number.isInteger(from)) return;
    event.preventDefault();
    onMove(from, index);
  };

  return (
    <li
      className="test-row"
      data-test-id={test.id}
      aria-label={name}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        if (!readOnly) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <div className="test-row-header">
        {readOnly ? null : (
          <button
            type="button"
            className="drag-handle"
            draggable
            onDragStart={onDragStart}
            aria-label={`Drag to reorder ${name}`}
            title="Drag to reorder (or Alt+↑ / Alt+↓)"
          >
            ⠿
          </button>
        )}
        <label htmlFor={labelId} className="visually-hidden">
          Label for {name}
        </label>
        <input
          id={labelId}
          className="test-label"
          placeholder={`Test ${index + 1}`}
          value={test.label}
          readOnly={readOnly}
          onChange={(event) => onChange({ ...test, label: event.target.value })}
        />
        {validation.valid ? null : <span className="badge badge-error">Invalid</span>}
        <button
          type="button"
          className="button button-small"
          aria-label={`Run ${name}`}
          disabled={running}
          onClick={() => onRun(test.id)}
        >
          Run
        </button>
        {readOnly ? null : (
          <div className="row-actions">
            <button
              type="button"
              className="button button-quiet button-small"
              aria-label={`Move ${name} up`}
              disabled={index === 0}
              onClick={() => onMove(index, index - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="button button-quiet button-small"
              aria-label={`Move ${name} down`}
              disabled={index === count - 1}
              onClick={() => onMove(index, index + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="button button-quiet button-small"
              aria-label={`Duplicate ${name}`}
              onClick={() => onDuplicate(index)}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="button button-quiet button-small"
              aria-label={`Delete ${name}`}
              onClick={() => onDelete(index)}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <div className="test-fields">
        <JsonField
          label="Arguments"
          hint={params.length === 0 ? undefined : `[${params.join(", ")}]`}
          value={test.argsText}
          error={validation.args}
          readOnly={readOnly}
          autoFocus={autoFocus}
          onChange={(argsText) => onChange({ ...test, argsText })}
        />
        <JsonField
          label="Expected"
          value={test.expectedText}
          error={validation.expected}
          readOnly={readOnly}
          onChange={(expectedText) => onChange({ ...test, expectedText })}
        />
        <div className="field">
          <label htmlFor={compareId} className="field-label">
            Compare
          </label>
          <select
            id={compareId}
            value={compareValue(test.compare)}
            disabled={readOnly}
            onChange={(event) => onChange({ ...test, compare: parseCompare(event.target.value) })}
          >
            <option value="return">Return value</option>
            {Array.from({ length: Math.max(argCount, 1) }, (_, argument) => (
              <option key={argument} value={`argument-${argument}`}>
                Argument {argument + 1}
                {params[argument] === undefined ? "" : ` (${params[argument]})`} after the call
              </option>
            ))}
          </select>
          {validation.compare === undefined ? null : (
            <p className="field-error">{validation.compare}</p>
          )}
        </div>
      </div>
      {validation.warning === undefined ? null : <p className="hint">{validation.warning}</p>}
    </li>
  );
};

interface TestListProps {
  workspaceId: string;
  tests: TestCase[];
  params: readonly string[];
  readOnly: boolean;
  running: boolean;
  onChange: (tests: TestCase[]) => void;
  onRunTest: (testId: string) => void;
}

const withPositions = (tests: TestCase[]): TestCase[] =>
  tests.map((test, position) => (test.position === position ? test : { ...test, position }));

/** The Tests tab. See specs/test-cases.md, "Authoring". */
export const TestList = ({
  workspaceId,
  tests,
  params,
  readOnly,
  running,
  onChange,
  onRunTest,
}: TestListProps) => {
  const showToast = useToast();
  const [focusId, setFocusId] = useState<string | null>(null);
  const latest = useRef(tests);
  latest.current = tests;

  const update = (next: TestCase[]): void => onChange(withPositions(next));

  const add = (): void => {
    const test: TestCase = {
      id: newId(),
      workspaceId,
      position: tests.length,
      label: "",
      argsText: "[]",
      expectedText: "",
      compare: { kind: "return" },
    };
    setFocusId(test.id);
    update([...tests, test]);
  };

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= tests.length) return;
    const next = [...tests];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    update(next);
  };

  const duplicate = (index: number): void => {
    const source = tests[index];
    if (source === undefined || tests.length >= MAX_TESTS_PER_WORKSPACE) return;
    const copy = { ...source, id: newId() };
    const next = [...tests];
    next.splice(index + 1, 0, copy);
    update(next);
  };

  const remove = (index: number): void => {
    const removed = tests[index];
    if (removed === undefined) return;
    update(tests.filter((_, position) => position !== index));
    const name = removed.label === "" ? `Test ${index + 1}` : `“${removed.label}”`;
    showToast({
      message: `${name} deleted.`,
      action: {
        label: "Undo",
        onClick: () => {
          const next = [...latest.current];
          next.splice(Math.min(index, next.length), 0, removed);
          update(next);
        },
      },
    });
  };

  const replace = (test: TestCase): void => {
    update(tests.map((existing) => (existing.id === test.id ? test : existing)));
  };

  const full = tests.length >= MAX_TESTS_PER_WORKSPACE;

  return (
    <div className="test-list">
      {tests.length === 0 ? (
        <p className="hint">
          No tests yet. Each test gives the function's arguments as a JSON array and the value you
          expect back.
        </p>
      ) : (
        <ol className="test-rows">
          {tests.map((test, index) => (
            <TestRow
              key={test.id}
              test={test}
              index={index}
              count={tests.length}
              params={params}
              readOnly={readOnly}
              running={running}
              autoFocus={test.id === focusId}
              onChange={replace}
              onRun={onRunTest}
              onMove={move}
              onDuplicate={duplicate}
              onDelete={remove}
            />
          ))}
        </ol>
      )}
      {readOnly ? null : (
        <div className="actions">
          <button type="button" className="button" onClick={add} disabled={full}>
            Add test
          </button>
          {full ? (
            <span className="hint">The limit is {MAX_TESTS_PER_WORKSPACE} tests.</span>
          ) : null}
        </div>
      )}
    </div>
  );
};
