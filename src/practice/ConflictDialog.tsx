import { useEffect, useId, useRef } from "react";
import type { ConflictRecord } from "../db/database.ts";
import type { WorkspaceDoc } from "../sync/protocol.ts";
import type { TestCase, Workspace } from "../workspaces/model.ts";
import { DiffView } from "./HistoryDialog.tsx";

interface Props {
  open: boolean;
  conflict: ConflictRecord | null;
  workspace: Workspace;
  tests: TestCase[];
  theme: "light" | "dark";
  onClose: () => void;
}

const testChanges = (ours: TestCase[], theirs: WorkspaceDoc["tests"]): string[] => {
  const local = new Map(ours.map((test) => [test.id, test]));
  const remote = new Map(theirs.map((test) => [test.id, test]));
  const changes: string[] = [];
  for (const test of ours) {
    const other = remote.get(test.id);
    if (other === undefined)
      changes.push(`${test.label || "Unnamed test"}: removed on the other device`);
    else if (
      test.label !== other.label ||
      test.argsText !== other.argsText ||
      test.expectedText !== other.expectedText ||
      JSON.stringify(test.compare) !== JSON.stringify(other.compare) ||
      test.kind !== other.kind ||
      JSON.stringify(test.inputAdapters) !== JSON.stringify(other.inputAdapters) ||
      test.outputAdapter !== other.outputAdapter ||
      JSON.stringify(test.comparison) !== JSON.stringify(other.comparison)
    ) {
      changes.push(`${test.label || "Unnamed test"}: changed`);
    }
  }
  for (const test of theirs)
    if (!local.has(test.id))
      changes.push(`${test.label || "Unnamed test"}: added on the other device`);
  return changes;
};

export const ConflictDialog = ({ open, conflict, workspace, tests, theme, onClose }: Props) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const doc = conflict?.doc as WorkspaceDoc | null | undefined;
  const changes = doc === null || doc === undefined ? [] : testChanges(tests, doc.tests);
  const folderChanged =
    doc !== null && doc !== undefined && (doc.folder ?? "") !== (workspace.folder ?? "");
  const tagsChanged =
    doc !== null &&
    doc !== undefined &&
    JSON.stringify(doc.tags ?? []) !== JSON.stringify(workspace.tags ?? []);
  return (
    <dialog ref={ref} className="history-dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-body">
        <div className="page-heading">
          <h2 id={titleId}>Compare versions</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
        {conflict?.deleted ? (
          <p>
            The workspace was deleted on the other device. Your local code is still available until
            you resolve this conflict.
          </p>
        ) : null}
        {doc === null || doc === undefined ? null : (
          <>
            <p className="hint">Theirs on the left, yours on the right.</p>
            {open ? (
              <DiffView
                original={doc.source}
                modified={workspace.source}
                language={workspace.language}
                theme={theme}
              />
            ) : null}
            {folderChanged || tagsChanged ? (
              <>
                <h3>Organization changes</h3>
                <ul>
                  {folderChanged ? (
                    <li>
                      Folder: theirs “{doc.folder || "Unfiled"}”, yours “
                      {workspace.folder || "Unfiled"}”
                    </li>
                  ) : null}
                  {tagsChanged ? (
                    <li>
                      Tags: theirs {doc.tags?.join(", ") || "none"}; yours{" "}
                      {workspace.tags?.join(", ") || "none"}
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
            <h3>Test changes</h3>
            {changes.length === 0 ? (
              <p className="hint">No test changes.</p>
            ) : (
              <ul>
                {changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </dialog>
  );
};
