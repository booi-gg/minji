import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { getDatabase } from "../db/database.ts";
import { readLastLanguage, saveImportedWorkspaces } from "../workspaces/actions.ts";
import { displayTitle } from "../workspaces/model.ts";
import { parseExportFile, toBundle, type ExportedWorkspace } from "./exportFormat.ts";
import { parseProblem, type ImportDraft } from "./parseProblem.ts";
import { ReviewPage, type ReviewEntry } from "./ReviewPage.tsx";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_EXTENSION = /\.(md|markdown|txt|json)$/i;

interface Parsed {
  fileName: string;
  workspaces: ExportedWorkspace[];
  skipped: number;
}

const testCountText = (count: number): string => (count === 1 ? "1 test" : `${count} tests`);

export const ImportPage = () => {
  const navigate = useNavigate();
  const inputId = useId();
  const [tab, setTab] = useState<"paste" | "upload">("paste");
  const [text, setText] = useState("");
  const [starter, setStarter] = useState("");
  const [review, setReview] = useState<ReviewEntry | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const reviewText = (source: string, format: "text" | "markdown", code?: string): void => {
    const draft: ImportDraft = parseProblem({
      text: source,
      starter: code,
      format,
      fallbackLanguage: readLastLanguage() ?? "typescript",
    });
    setParsed(null);
    setError(null);
    setReview({ kind: "problem", draft });
  };

  const readFile = async (file: File): Promise<void> => {
    setError(null);
    setParsed(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("This file is larger than the 10 MB limit.");
      return;
    }
    const extension = FILE_EXTENSION.exec(file.name)?.[1]?.toLowerCase();
    if (extension === undefined) {
      setError("Choose a .md, .markdown, .txt or .json file.");
      return;
    }
    try {
      const contents = await file.text();
      if (extension !== "json") {
        reviewText(contents, extension === "txt" ? "text" : "markdown");
        return;
      }
      const result = parseExportFile(contents);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.workspaces.length === 0) {
        setError("This file has no problems that can be imported.");
        return;
      }
      if (result.workspaces.length === 1) {
        setReview({ kind: "json", workspace: result.workspaces[0] });
        return;
      }
      setParsed({
        fileName: file.name,
        workspaces: result.workspaces,
        skipped: result.skipped.length,
      });
      setSelected(new Set(result.workspaces.map((_, index) => index)));
    } catch {
      setError("This file couldn't be read. Choose it again.");
    }
  };

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file !== undefined) void readFile(file);
    event.target.value = "";
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
      await navigate("/");
    } catch {
      setError("The selected problems couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (review !== null) {
    return <ReviewPage entry={review} onBack={() => setReview(null)} />;
  }

  return (
    <main className="page import-page">
      <div className="page-heading">
        <h1>Import problem</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="Import method">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "paste"}
          className="tab"
          onClick={() => setTab("paste")}
        >
          Paste text
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "upload"}
          className="tab"
          onClick={() => setTab("upload")}
        >
          Upload file
        </button>
      </div>

      {tab === "paste" ? (
        <section className="import-form" aria-label="Paste problem">
          <label className="field">
            <span className="field-label">Problem text or Markdown</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={15}
              placeholder="Paste the problem statement and examples"
            />
          </label>
          <label className="field">
            <span className="field-label">Starter code (optional)</span>
            <textarea
              className="code-input"
              value={starter}
              onChange={(event) => setStarter(event.target.value)}
              rows={6}
              placeholder="function solve(...) { ... }"
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="button button-primary"
              disabled={text.trim() === "" && starter.trim() === ""}
              onClick={() => reviewText(text, "markdown", starter)}
            >
              Continue
            </button>
          </div>
        </section>
      ) : (
        <section className="import-form" aria-label="Upload problem file">
          <p className="page-intro">Upload a problem statement or a minji JSON backup.</p>
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
            <label htmlFor={inputId}>
              Choose a .md, .markdown, .txt or .json file, or drop it here
            </label>
            <input
              id={inputId}
              type="file"
              accept=".md,.markdown,.txt,.json,text/plain,text/markdown,application/json"
              onChange={onFileChosen}
            />
            <p className="hint">Up to 10 MB.</p>
          </div>
        </section>
      )}

      {error === null ? null : (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {parsed === null ? null : (
        <section className="section" aria-labelledby="import-list-heading">
          <h2 id="import-list-heading">
            {parsed.workspaces.length} workspaces in {parsed.fileName}
          </h2>
          {parsed.skipped > 0 ? (
            <p className="hint">
              {parsed.skipped} entries were skipped because they have no title or source.
            </p>
          ) : null}
          <ul className="check-list">
            {parsed.workspaces.map((workspace, index) => (
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
