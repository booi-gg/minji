import { useEffect, useId, useState } from "react";
import {
  Check,
  CircleAlert,
  Ellipsis,
  History,
  LoaderCircle,
  Paintbrush,
  Play,
  RotateCcw,
  Square,
  type LucideIcon,
} from "lucide-react";
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
    <div className="entry-point-field">
      <label htmlFor={id} className="toolbar-label">
        Entry point
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

const STATUS_ICON: Record<SaveStatus, LucideIcon> = {
  saved: Check,
  saving: LoaderCircle,
  failed: CircleAlert,
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
  onFunctionNameChange: (name: string) => void;
  onTimeoutChange: (ms: number) => void;
  onExport: () => void;
  onShortcuts: () => void;
}

const MoreMenu = ({
  workspace,
  readOnly,
  settings,
  onFunctionNameChange,
  onTimeoutChange,
  onExport,
  onShortcuts,
}: MoreMenuProps) => {
  const timeoutId = useId();
  const themeId = useId();
  const formatId = useId();
  return (
    <details className="menu">
      <summary className="button button-quiet icon-button" aria-label="More" title="More">
        <Ellipsis size={16} aria-hidden="true" />
      </summary>
      <div className="menu-panel">
        <div className="menu-field">
          <FunctionNameField
            name={workspace.functionName}
            source={workspace.source}
            readOnly={readOnly}
            onChange={onFunctionNameChange}
          />
        </div>
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
  const SaveIcon = STATUS_ICON[saveStatus];

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
      <div className="toolbar-spacer" />
      <div className="actions">
        {running ? (
          <button
            type="button"
            className="button button-danger icon-button"
            aria-label="Stop running tests"
            title="Stop running tests"
            onClick={onStop}
          >
            <Square size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary icon-button"
            aria-label="Run all tests"
            title="Run all tests"
            onClick={onRunAll}
          >
            <Play size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="button icon-button"
          aria-label="Format code"
          title="Format code"
          onClick={onFormat}
          disabled={readOnly}
        >
          <Paintbrush size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="button icon-button"
          aria-label="Reset code"
          title="Reset code"
          onClick={onReset}
          disabled={readOnly || unchanged}
        >
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="button icon-button"
          aria-label="History"
          title="History"
          onClick={onHistory}
        >
          <History size={16} aria-hidden="true" />
        </button>
        <MoreMenu
          workspace={workspace}
          readOnly={readOnly}
          settings={settings}
          onFunctionNameChange={onFunctionNameChange}
          onTimeoutChange={onTimeoutChange}
          onExport={onExport}
          onShortcuts={onShortcuts}
        />
      </div>
      {readOnly ? null : (
        <span className="save-status" data-status={saveStatus} title={STATUS_TEXT[saveStatus]}>
          <SaveIcon size={16} aria-hidden="true" />
          <span className="visually-hidden" role="status">
            {STATUS_TEXT[saveStatus]}
          </span>
          {saveStatus === "failed" ? (
            <button
              type="button"
              className="button button-quiet icon-button"
              aria-label="Retry save"
              title="Retry save"
              onClick={onRetrySave}
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      )}
    </div>
  );
};
