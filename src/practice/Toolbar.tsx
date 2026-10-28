import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { ThemeSetting } from "../app/theme.ts";
import type { Language } from "../runner/types.ts";
import { isValidIdentifier } from "../shared/ids.ts";
import { MAX_TEST_TIMEOUT_MS, MIN_TEST_TIMEOUT_MS } from "../shared/limits.ts";
import type { Workspace } from "../workspaces/model.ts";
import type { SaveStatus } from "./autosave.ts";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, type EditorSettings } from "./settings.ts";

const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rough check that the code defines or assigns the function. */
const mentionsFunction = (source: string, name: string): boolean =>
  new RegExp(
    `(?:function|class)\\s+${escapeRegExp(name)}\\b|\\b${escapeRegExp(name)}\\s*[=(]`,
  ).test(source);

interface FunctionNameFieldProps {
  name: string;
  source: string;
  readOnly: boolean;
  onChange: (name: string) => void;
}

const FunctionNameField = ({ name, source, readOnly, onChange }: FunctionNameFieldProps) => {
  const id = useId();
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const valid = isValidIdentifier(draft);
  const message = !valid
    ? "Use a JavaScript identifier, like twoSum."
    : mentionsFunction(source, draft)
      ? undefined
      : `No function or class named ${draft} in your code`;

  return (
    <div className="toolbar-field">
      <label htmlFor={id} className="toolbar-label">
        Function or class
      </label>
      <input
        id={id}
        className="function-input"
        value={draft}
        readOnly={readOnly}
        spellCheck={false}
        aria-invalid={!valid}
        aria-describedby={message === undefined ? undefined : `${id}-message`}
        onChange={(event) => {
          setDraft(event.target.value);
          if (isValidIdentifier(event.target.value)) onChange(event.target.value);
        }}
      />
      {message === undefined ? null : (
        <span id={`${id}-message`} className={valid ? "toolbar-note" : "toolbar-note field-error"}>
          {message}
        </span>
      )}
    </div>
  );
};

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  saving: "Saving…",
  failed: "Couldn't save",
};

interface ToolbarProps {
  workspace: Workspace;
  readOnly: boolean;
  saveStatus: SaveStatus;
  settings: EditorSettings;
  running: boolean;
  onRunAll: () => void;
  onStop: () => void;
  onTitleChange: (title: string) => void;
  onLanguageChange: (language: Language) => void;
  onFunctionNameChange: (name: string) => void;
  onTimeoutChange: (ms: number) => void;
  onRetrySave: () => void;
  onReset: () => void;
  onFormat: () => void;
  onHistory: () => void;
  onExport: () => void;
  onShortcuts: () => void;
}

interface MoreMenuProps {
  workspace: Workspace;
  readOnly: boolean;
  settings: EditorSettings;
  onTimeoutChange: (ms: number) => void;
  onExport: () => void;
  onShortcuts: () => void;
}

const MoreMenu = ({
  workspace,
  readOnly,
  settings,
  onTimeoutChange,
  onExport,
  onShortcuts,
}: MoreMenuProps) => {
  const timeoutId = useId();
  const themeId = useId();
  const formatId = useId();
  return (
    <details className="menu">
      <summary className="button button-quiet">More</summary>
      <div className="menu-panel">
        <button type="button" className="menu-item" onClick={onExport}>
          Export workspace
        </button>
        <button type="button" className="menu-item" onClick={onShortcuts}>
          Keyboard shortcuts
        </button>
        <div className="menu-field">
          <label htmlFor={timeoutId}>Test timeout (seconds)</label>
          <input
            id={timeoutId}
            type="number"
            min={MIN_TEST_TIMEOUT_MS / 1000}
            max={MAX_TEST_TIMEOUT_MS / 1000}
            step={0.5}
            value={workspace.testTimeoutMs / 1000}
            disabled={readOnly}
            onChange={(event) => {
              const ms = Math.round(Number(event.target.value) * 1000);
              if (ms >= MIN_TEST_TIMEOUT_MS && ms <= MAX_TEST_TIMEOUT_MS) onTimeoutChange(ms);
            }}
          />
        </div>
        <div className="menu-field menu-field-inline">
          <input
            id={formatId}
            type="checkbox"
            checked={settings.formatOnSave}
            onChange={(event) => settings.setFormatOnSave(event.target.checked)}
          />
          <label htmlFor={formatId}>Format on save</label>
        </div>
        <div className="menu-field">
          <span id={`${formatId}-font`}>Font size</span>
          <div className="stepper" role="group" aria-labelledby={`${formatId}-font`}>
            <button
              type="button"
              className="button button-small"
              aria-label="Smaller font"
              disabled={settings.fontSize <= MIN_FONT_SIZE}
              onClick={() => settings.setFontSize(settings.fontSize - 1)}
            >
              −
            </button>
            <span aria-live="polite">{settings.fontSize}px</span>
            <button
              type="button"
              className="button button-small"
              aria-label="Larger font"
              disabled={settings.fontSize >= MAX_FONT_SIZE}
              onClick={() => settings.setFontSize(settings.fontSize + 1)}
            >
              +
            </button>
          </div>
        </div>
        <div className="menu-field">
          <label htmlFor={themeId}>Theme</label>
          <select
            id={themeId}
            value={settings.theme}
            onChange={(event) => settings.setTheme(event.target.value as ThemeSetting)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>
    </details>
  );
};

/** See specs/practice-editor.md, "Toolbar". */
export const Toolbar = ({
  workspace,
  readOnly,
  saveStatus,
  settings,
  running,
  onRunAll,
  onStop,
  onTitleChange,
  onLanguageChange,
  onFunctionNameChange,
  onTimeoutChange,
  onRetrySave,
  onReset,
  onFormat,
  onHistory,
  onExport,
  onShortcuts,
}: ToolbarProps) => {
  const titleId = useId();
  const languageId = useId();
  const unchanged = workspace.source === workspace.starterSource;

  return (
    <div className="toolbar">
      <Link className="button button-quiet" to="/" aria-label="All workspaces">
        ←
      </Link>
      <label htmlFor={titleId} className="visually-hidden">
        Title
      </label>
      <input
        id={titleId}
        className="title-input"
        placeholder="Untitled"
        value={workspace.title}
        readOnly={readOnly}
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <div className="toolbar-field">
        <label htmlFor={languageId} className="toolbar-label">
          Language
        </label>
        <select
          id={languageId}
          value={workspace.language}
          disabled={readOnly}
          onChange={(event) => onLanguageChange(event.target.value as Language)}
        >
          <option value="typescript">TypeScript</option>
          <option value="javascript">JavaScript</option>
        </select>
      </div>
      <FunctionNameField
        name={workspace.functionName}
        source={workspace.source}
        readOnly={readOnly}
        onChange={onFunctionNameChange}
      />
      <div className="toolbar-spacer" />
      <div className="actions">
        {running ? (
          <button type="button" className="button button-danger" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="button button-primary" onClick={onRunAll}>
            Run all
          </button>
        )}
        <button type="button" className="button" onClick={onFormat} disabled={readOnly}>
          Format
        </button>
        <button type="button" className="button" onClick={onReset} disabled={readOnly || unchanged}>
          Reset code
        </button>
        <button type="button" className="button" onClick={onHistory}>
          History
        </button>
        <MoreMenu
          workspace={workspace}
          readOnly={readOnly}
          settings={settings}
          onTimeoutChange={onTimeoutChange}
          onExport={onExport}
          onShortcuts={onShortcuts}
        />
      </div>
      {readOnly ? null : (
        <span className="save-status" data-status={saveStatus}>
          {STATUS_TEXT[saveStatus]}
          {saveStatus === "failed" ? (
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={onRetrySave}
            >
              Retry
            </button>
          ) : null}
        </span>
      )}
    </div>
  );
};
