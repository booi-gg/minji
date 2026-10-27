import { useId, useState } from "react";
import { Markdown } from "./Markdown.tsx";

type Tab = "statement" | "notes";

interface StatementPanelProps {
  statement: string;
  notes: string;
  readOnly: boolean;
  onStatementChange: (statement: string) => void;
  onNotesChange: (notes: string) => void;
}

interface TextSectionProps {
  label: string;
  text: string;
  emptyText: string;
  editing: boolean;
  readOnly: boolean;
  onChange: (text: string) => void;
}

const TextSection = ({ label, text, emptyText, editing, readOnly, onChange }: TextSectionProps) => {
  if (editing && !readOnly) {
    return (
      <textarea
        className="text-editor"
        aria-label={label}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return text.trim() === "" ? <p className="hint">{emptyText}</p> : <Markdown text={text} />;
};

/** Statement and notes tabs. See specs/practice-editor.md, "Statement and notes". */
export const StatementPanel = ({
  statement,
  notes,
  readOnly,
  onStatementChange,
  onNotesChange,
}: StatementPanelProps) => {
  const [tab, setTab] = useState<Tab>(() => (statement.trim() === "" ? "notes" : "statement"));
  // The statement is shown rendered by default; notes are edited by default.
  const [editingStatement, setEditingStatement] = useState(false);
  const [previewingNotes, setPreviewingNotes] = useState(false);
  const baseId = useId();

  const tabs: { id: Tab; label: string }[] = [
    { id: "statement", label: "Statement" },
    { id: "notes", label: "Notes" },
  ];

  const toggleLabel =
    tab === "statement"
      ? editingStatement
        ? "Preview"
        : "Edit"
      : previewingNotes
        ? "Edit"
        : "Preview";
  const toggle = (): void => {
    if (tab === "statement") setEditingStatement((value) => !value);
    else setPreviewingNotes((value) => !value);
  };

  return (
    <section className="panel" aria-label="Statement and notes">
      <div className="panel-header">
        <div role="tablist" aria-label="Statement and notes" className="tabs">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${baseId}-${id}-tab`}
              aria-controls={`${baseId}-${id}-panel`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              className="tab"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {readOnly ? null : (
          <button type="button" className="button button-quiet button-small" onClick={toggle}>
            {toggleLabel}
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-${tab}-panel`}
        aria-labelledby={`${baseId}-${tab}-tab`}
        className="panel-body"
      >
        {tab === "statement" ? (
          <TextSection
            label="Statement"
            text={statement}
            emptyText="No statement. Choose Edit to paste or write one."
            editing={editingStatement}
            readOnly={readOnly}
            onChange={onStatementChange}
          />
        ) : (
          <TextSection
            label="Notes"
            text={notes}
            emptyText="No notes yet."
            editing={!previewingNotes}
            readOnly={readOnly}
            onChange={onNotesChange}
          />
        )}
      </div>
    </section>
  );
};
