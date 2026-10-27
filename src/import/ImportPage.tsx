import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { getDatabase } from "../db/database.ts";
import { saveImportedWorkspaces } from "../workspaces/actions.ts";
import { displayTitle } from "../workspaces/model.ts";
import { parseExportFile, toBundle, type ExportedWorkspace } from "./exportFormat.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface Parsed {
  fileName: string;
  workspaces: ExportedWorkspace[];
  skipped: number;
}

const testCountText = (count: number): string => (count === 1 ? "1 test" : `${count} tests`);

/**
 * Step 1 version: imports minji JSON files (exports or hand-written problem files).
 * Paste and Markdown import with a review screen arrive in step 4.
 */
export const ImportPage = () => {
  const navigate = useNavigate();
  const inputId = useId();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const readFile = async (file: File): Promise<void> => {
    setError(null);
    setParsed(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("This file is larger than the 10 MB limit.");
      return;
    }
    const result = parseExportFile(await file.text());
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.workspaces.length === 0) {
      setError("This file has no workspaces that can be imported.");
      return;
    }
    setParsed({
      fileName: file.name,
      workspaces: result.workspaces,
      skipped: result.skipped.length,
    });
    setSelected(new Set(result.workspaces.map((_, index) => index)));
  };

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file !== undefined) void readFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) void readFile(file);
  };

  const toggle = (index: number): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const importSelected = async (): Promise<void> => {
    if (parsed === null) return;
    setSaving(true);
    try {
      const bundles = parsed.workspaces
        .filter((_, index) => selected.has(index))
        .map((workspace) => toBundle(workspace));
      await saveImportedWorkspaces(await getDatabase(), bundles);
      const [only] = bundles;
      await navigate(bundles.length === 1 && only !== undefined ? `/w/${only.workspace.id}` : "/");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page">
      <div className="page-heading">
        <h1>Import problem</h1>
      </div>
      <p className="page-intro">
        Import a minji JSON file: a backup from <strong>Export</strong>, or a problem file with a
        title, statement, starter code and tests. Each workspace is added as a new copy.
      </p>

      <div
        className="drop-zone"
        data-active={dragging}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label htmlFor={inputId}>Choose a .json file, or drop it here</label>
        <input id={inputId} type="file" accept=".json,application/json" onChange={onFileChosen} />
        <p className="hint">Up to 10 MB.</p>
      </div>

      {error === null ? null : (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {parsed === null ? null : (
        <section className="section" aria-labelledby="import-list-heading">
          <h2 id="import-list-heading">
            {parsed.workspaces.length === 1
              ? "1 workspace"
              : `${parsed.workspaces.length} workspaces`}{" "}
            in {parsed.fileName}
          </h2>
          {parsed.skipped > 0 ? (
            <p className="hint">
              {parsed.skipped === 1
                ? "1 entry was skipped because it has no title or source."
                : `${parsed.skipped} entries were skipped because they have no title or source.`}
            </p>
          ) : null}
          <ul className="check-list">
            {parsed.workspaces.map((workspace, index) => (
              // Entries have no ids until they are imported; the file order is stable.
              // oxlint-disable-next-line react/no-array-index-key
              <li key={index}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(index)}
                    onChange={() => toggle(index)}
                  />
                  <span>
                    {displayTitle(workspace)}{" "}
                    <span className="hint">· {testCountText(workspace.tests.length)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void importSelected()}
              disabled={selected.size === 0 || saving}
            >
              Import selected
            </button>
          </div>
        </section>
      )}
    </main>
  );
};
