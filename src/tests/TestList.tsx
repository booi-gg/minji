import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, X } from "lucide-react";
import type { CompareTarget, NodeAdapter } from "../runner/types.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { newId } from "../shared/ids.ts";
import { MAX_TESTS_PER_WORKSPACE } from "../shared/limits.ts";
import { useToast } from "../shared/toast.tsx";
import type { TestCase } from "../workspaces/model.ts";
import { joinArguments, splitArguments } from "./arguments.ts";
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
  functionName: string;
  readOnly: boolean;
  autoFocus: boolean;
  onChange: (test: TestCase) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
}

const TestRow = ({
  test,
  index,
  count,
  params,
  functionName,
  readOnly,
  autoFocus,
  onChange,
  onMove,
  onDuplicate,
}: TestRowProps) => {
  const compareId = useId();
  const labelId = useId();
  const kindId = useId();
  const outputId = useId();
  const toleranceId = useId();
  const current = useMemo(
    () => validateTest(test, params, functionName),
    [test, params, functionName],
  );
  const validation: TestValidation = useSettled(current);
  const name = test.label === "" ? `Case ${index + 1}` : test.label;
  const argCount = current.argCount ?? params.length;
  const kind = test.kind ?? "function";
  const argumentParts =
    kind === "function" && test.argsText.length <= LARGE_TEXT_CHARS
      ? splitArguments(test.argsText)
      : null;
  const visibleArgumentCount = Math.max(params.length, argumentParts?.length ?? 0);
  const hasOptions =
    kind === "class" ||
    test.compare.kind !== "return" ||
    test.inputAdapters?.some((adapter) => adapter !== "plain") === true ||
    (test.outputAdapter !== undefined && test.outputAdapter !== "plain") ||
    test.comparison?.unordered === true ||
    test.comparison?.tolerance !== undefined;
  const adapterOptions = (
    <>
      <option value="plain">Plain JSON</option>
      <option value="linked-list">Linked list</option>
      <option value="binary-tree">Binary tree</option>
    </>
  );

  return (
    <li className="test-row" data-test-id={test.id} aria-label={name}>
      <div className="test-fields">
        <div className="test-arguments">
          {argumentParts === null ? (
            <JsonField
              label={kind === "class" ? "Calls" : "Arguments"}
              value={test.argsText}
              error={validation.args}
              readOnly={readOnly}
              autoFocus={autoFocus}
              onChange={(argsText) => onChange({ ...test, argsText })}
            />
          ) : (
            Array.from({ length: visibleArgumentCount }, (_, argument) => (
              <JsonField
                key={argument}
                label={`${params[argument] ?? `Argument ${argument + 1}`} =`}
                value={argumentParts[argument] ?? ""}
                error={argument === 0 ? validation.args : undefined}
                readOnly={readOnly}
                autoFocus={autoFocus && argument === 0}
                onChange={(value) => {
                  const next = [...argumentParts];
                  while (next.length <= argument) next.push("");
                  next[argument] = value;
                  onChange({ ...test, argsText: joinArguments(next) });
                }}
              />
            ))
          )}
          {visibleArgumentCount === 0 && argumentParts !== null ? (
            <p className="hint">This function takes no arguments.</p>
          ) : null}
        </div>
        <div className="test-expected">
          <JsonField
            label="Expected ="
            value={test.expectedText}
            error={validation.expected}
            readOnly={readOnly}
            onChange={(expectedText) => onChange({ ...test, expectedText })}
          />
        </div>
        <details className="test-options">
          <summary>Options{hasOptions ? " · customized" : ""}</summary>
          <div className="test-options-content">
            <div className="test-case-actions">
              <label htmlFor={labelId} className="field-label">
                Case name
              </label>
              <input
                id={labelId}
                placeholder={`Case ${index + 1}`}
                value={test.label}
                readOnly={readOnly}
                onChange={(event) => onChange({ ...test, label: event.target.value })}
              />
              {readOnly ? null : (
                <div className="row-actions">
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    aria-label={`Move ${name} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    aria-label={`Move ${name} down`}
                    title="Move down"
                    disabled={index === count - 1}
                    onClick={() => onMove(index, index + 1)}
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    aria-label={`Duplicate ${name}`}
                    title="Duplicate"
                    onClick={() => onDuplicate(index)}
                  >
                    <Copy size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor={kindId} className="field-label">
                Test type
              </label>
              <select
                id={kindId}
                value={kind}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({
                    ...test,
                    kind: event.target.value as "function" | "class",
                    argsText:
                      event.target.value === "class" && test.argsText === "[]"
                        ? JSON.stringify([[functionName], [[]]])
                        : test.argsText,
                    expectedText:
                      event.target.value === "class" && test.expectedText === ""
                        ? "[null]"
                        : test.expectedText,
                    compare: { kind: "return" },
                    inputAdapters: event.target.value === "class" ? [] : test.inputAdapters,
                    outputAdapter: event.target.value === "class" ? "plain" : test.outputAdapter,
                  })
                }
              >
                <option value="function">Function call</option>
                <option value="class">Class method sequence</option>
              </select>
            </div>
            {kind === "class" ? null : (
              <div className="field">
                <label htmlFor={compareId} className="field-label">
                  Compare
                </label>
                <select
                  id={compareId}
                  value={compareValue(test.compare)}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange({ ...test, compare: parseCompare(event.target.value) })
                  }
                >
                  <option value="return">Return value</option>
                  {Array.from({ length: Math.max(argCount, 1) }, (_, argument) => (
                    <option key={argument} value={`argument-${argument}`}>
                      Argument {argument + 1}
                      {params[argument] === undefined ? "" : ` (${params[argument]})`} after the
                      call
                    </option>
                  ))}
                </select>
                {validation.compare === undefined ? null : (
                  <p className="field-error">{validation.compare}</p>
                )}
              </div>
            )}
            {kind === "class" ? null : (
              <>
                {Array.from({ length: argCount }, (_, argument) => (
                  <div className="field" key={argument}>
                    <label className="field-label" htmlFor={`${kindId}-arg-${argument}`}>
                      Argument {argument + 1} adapter
                    </label>
                    <select
                      id={`${kindId}-arg-${argument}`}
                      value={test.inputAdapters?.[argument] ?? "plain"}
                      disabled={readOnly}
                      onChange={(event) => {
                        const inputAdapters = [...(test.inputAdapters ?? [])];
                        inputAdapters[argument] = event.target.value as NodeAdapter;
                        onChange({ ...test, inputAdapters });
                      }}
                    >
                      {adapterOptions}
                    </select>
                  </div>
                ))}
                <div className="field">
                  <label className="field-label" htmlFor={outputId}>
                    Result adapter
                  </label>
                  <select
                    id={outputId}
                    value={test.outputAdapter ?? "plain"}
                    disabled={readOnly}
                    onChange={(event) =>
                      onChange({ ...test, outputAdapter: event.target.value as NodeAdapter })
                    }
                  >
                    {adapterOptions}
                  </select>
                </div>
              </>
            )}
            <label className="field">
              <span className="field-label">Comparison</span>
              <span>
                <input
                  type="checkbox"
                  checked={test.comparison?.unordered ?? false}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange({
                      ...test,
                      comparison: { ...test.comparison, unordered: event.target.checked },
                    })
                  }
                />{" "}
                Ignore outer array order
              </span>
            </label>
            <div className="field">
              <label className="field-label" htmlFor={toleranceId}>
                Numeric tolerance (absolute)
              </label>
              <input
                id={toleranceId}
                type="number"
                min="0"
                step="any"
                placeholder="Exact"
                value={test.comparison?.tolerance ?? ""}
                readOnly={readOnly}
                onChange={(event) =>
                  onChange({
                    ...test,
                    comparison: {
                      ...test.comparison,
                      tolerance: event.target.value === "" ? undefined : Number(event.target.value),
                    },
                  })
                }
              />
            </div>
          </div>
        </details>
      </div>
      {validation.options === undefined ? null : (
        <p className="field-error">{validation.options}</p>
      )}
      {validation.warning === undefined ? null : <p className="hint">{validation.warning}</p>}
    </li>
  );
};

interface TestListProps {
  workspaceId: string;
  tests: TestCase[];
  params: readonly string[];
  functionName: string;
  readOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (tests: TestCase[]) => void;
}

const withPositions = (tests: TestCase[]): TestCase[] =>
  tests.map((test, position) => (test.position === position ? test : { ...test, position }));

/** The Testcase tab. See specs/test-cases.md, "Authoring". */
export const TestList = ({
  workspaceId,
  tests,
  params,
  functionName,
  readOnly,
  selectedId,
  onSelect,
  onChange,
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
    onSelect(test.id);
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
    onSelect(copy.id);
    update(next);
  };

  const remove = (index: number): void => {
    const removed = tests[index];
    if (removed === undefined) return;
    if (selectedId === removed.id) {
      const neighbor = tests[index + 1] ?? tests[index - 1];
      if (neighbor !== undefined) onSelect(neighbor.id);
    }
    update(tests.filter((_, position) => position !== index));
    const name = removed.label === "" ? `Case ${index + 1}` : `“${removed.label}”`;
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
  const selected = tests.find((test) => test.id === selectedId) ?? tests[0];
  const selectedIndex = selected === undefined ? -1 : tests.indexOf(selected);

  return (
    <div className="test-list">
      <div className="case-picker" role="group" aria-label="Test cases">
        {tests.map((test, index) => {
          const caseName = test.label.trim() === "" ? `Case ${index + 1}` : test.label;
          const active = selected?.id === test.id;
          return (
            <span key={test.id} className={`case-tab${active ? " case-tab-active" : ""}`}>
              <button
                type="button"
                className="case-tab-select"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(test.id)}
              >
                {caseName}
              </button>
              {readOnly || tests.length === 1 ? null : (
                <button
                  type="button"
                  className="case-tab-remove"
                  aria-label={`Delete ${caseName}`}
                  title="Delete case"
                  onClick={() => remove(index)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </span>
          );
        })}
        {readOnly ? null : (
          <button
            type="button"
            className="case-add"
            aria-label="Add case"
            title="Add case"
            onClick={add}
            disabled={full}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {tests.length === 0 ? (
        <p className="hint">No cases yet. Add one to enter arguments and an expected output.</p>
      ) : (
        <ol className="test-rows">
          {selected === undefined ? null : (
            <TestRow
              key={selected.id}
              test={selected}
              index={selectedIndex}
              count={tests.length}
              params={params}
              functionName={functionName}
              readOnly={readOnly}
              autoFocus={selected.id === focusId}
              onChange={replace}
              onMove={move}
              onDuplicate={duplicate}
            />
          )}
        </ol>
      )}
      {full ? <span className="hint">The limit is {MAX_TESTS_PER_WORKSPACE} cases.</span> : null}
    </div>
  );
};
