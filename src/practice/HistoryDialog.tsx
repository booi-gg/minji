import { useEffect, useId, useRef, useState } from "react";
import type { Language } from "../runner/types.ts";
import { absoluteTime, relativeTime } from "../shared/format.ts";
import type { Revision } from "../workspaces/model.ts";
import { monaco } from "./monaco.ts";

interface DiffViewProps {
  original: string;
  modified: string;
  language: Language;
  theme: "light" | "dark";
}

/** Read-only Monaco diff: the revision on the left, the current code on the right. */
export const DiffView = ({ original, modified, language, theme }: DiffViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    const editor = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      originalAriaLabel: "Revision",
      modifiedAriaLabel: "Current code",
    });
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(modified, language);
    editor.setModel({ original: originalModel, modified: modifiedModel });
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [original, modified, language, theme]);
  return <div ref={containerRef} className="diff-view" />;
};

const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
};

interface HistoryDialogProps {
  open: boolean;
  revisions: Revision[];
  currentSource: string;
  theme: "light" | "dark";
  readOnly: boolean;
  onRestore: (revision: Revision) => void;
  onClose: () => void;
}

/** See specs/practice-editor.md, "Revisions and history". */
export const HistoryDialog = ({
  open,
  revisions,
  currentSource,
  theme,
  readOnly,
  onRestore,
  onClose,
}: HistoryDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [viewing, setViewing] = useState<Revision | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setViewing(null);
  }, [open]);

  return (
    <dialog ref={ref} className="history-dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-body">
        <div className="page-heading">
          <h2 id={titleId}>
            {viewing === null ? "History" : `Revision from ${relativeTime(viewing.createdAt)}`}
          </h2>
          <div className="actions">
            {viewing === null ? null : (
              <button type="button" className="button" onClick={() => setViewing(null)}>
                Back to list
              </button>
            )}
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {viewing !== null ? (
          <>
            <p className="hint">Left: this revision. Right: your current code.</p>
            {open ? (
              <DiffView
                original={viewing.source}
                modified={currentSource}
                language={viewing.language}
                theme={theme}
              />
            ) : null}
          </>
        ) : revisions.length === 0 ? (
          <p className="hint">
            No revisions yet. Press ⌘S / Ctrl+S to save one; runs will save them too.
          </p>
        ) : (
          <ul className="revision-list">
            {revisions.map((revision) => (
              <li key={revision.id} className="revision-row">
                <div className="workspace-main">
                  <time dateTime={revision.createdAt} title={absoluteTime(revision.createdAt)}>
                    {relativeTime(revision.createdAt)}
                  </time>
                  <span className="workspace-meta">
                    <span className="badge">{LANGUAGE_LABELS[revision.language]}</span>
                    <span>{revision.reason === "run" ? "Saved on run" : "Saved"}</span>
                  </span>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => setViewing(revision)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={readOnly}
                    onClick={() => onRestore(revision)}
                  >
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
};
