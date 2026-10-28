import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { getDatabase } from "../db/database.ts";
import { deleteWorkspace, listWorkspaces } from "../db/workspaces.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { postChannelMessage, subscribeToChannel } from "../shared/channel.ts";
import { absoluteTime, relativeTime } from "../shared/format.ts";
import { AccountControl } from "../sync/AccountControl.tsx";
import { useSync } from "../sync/SyncProvider.tsx";
import { copyToAccount, startSyncingWorkspace } from "../sync/store.ts";
import { createScratchWorkspace, exportWorkspaces, isStoragePersistent } from "./actions.ts";
import { displayTitle, type Workspace } from "./model.ts";
import { StorageBanner } from "./StorageBanner.tsx";

export const homeLoader = async () => {
  const db = await getDatabase();
  const [workspaces, persistent] = await Promise.all([listWorkspaces(db), isStoragePersistent(db)]);
  return { workspaces, persistent };
};

const LANGUAGE_LABELS = { javascript: "JavaScript", typescript: "TypeScript" } as const;

const lastRunText = (workspace: Workspace): string =>
  workspace.lastRun === null
    ? "Not run yet"
    : `${workspace.lastRun.passed}/${workspace.lastRun.total} passed`;

interface WorkspaceRowProps {
  workspace: Workspace;
  currentUserId: string | null;
  onExport: (workspace: Workspace) => void;
  onDelete: (workspace: Workspace) => void;
  onStartSync: (workspace: Workspace) => void;
  onCopy: (workspace: Workspace) => void;
}

const syncLabel = (workspace: Workspace, currentUserId: string | null): string | null => {
  if (workspace.ownerId !== null && workspace.ownerId !== currentUserId)
    return currentUserId === null ? "Local only" : "From another account";
  if (currentUserId === null) return null;
  if (workspace.syncState === "too-large") return "Too large to sync";
  if (workspace.syncState === "conflict") return "Conflict";
  if (workspace.syncState === "dirty") return "Syncing";
  if (workspace.syncState === "synced") return "Synced";
  return "Local only";
};

const WorkspaceRow = ({
  workspace,
  currentUserId,
  onExport,
  onDelete,
  onStartSync,
  onCopy,
}: WorkspaceRowProps) => {
  const title = displayTitle(workspace);
  const badge = syncLabel(workspace, currentUserId);
  return (
    <li className="workspace-row">
      <div className="workspace-main">
        <Link className="workspace-title" to={`/w/${workspace.id}`}>
          {title}
        </Link>
        <div className="workspace-meta">
          <span className="badge">{LANGUAGE_LABELS[workspace.language]}</span>
          <span>{lastRunText(workspace)}</span>
          {badge === null ? null : <span className="badge">{badge}</span>}
          <span>
            Updated{" "}
            <time dateTime={workspace.updatedAt} title={absoluteTime(workspace.updatedAt)}>
              {relativeTime(workspace.updatedAt)}
            </time>
          </span>
        </div>
      </div>
      <div className="actions">
        {currentUserId !== null && workspace.syncState === "excluded" ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => onStartSync(workspace)}
          >
            Start syncing
          </button>
        ) : null}
        {currentUserId !== null &&
        workspace.ownerId !== null &&
        workspace.ownerId !== currentUserId ? (
          <button type="button" className="button button-quiet" onClick={() => onCopy(workspace)}>
            Copy to this account
          </button>
        ) : null}
        <button
          type="button"
          className="button button-quiet"
          aria-label={`Export ${title}`}
          onClick={() => onExport(workspace)}
        >
          Export
        </button>
        <button
          type="button"
          className="button button-quiet"
          aria-label={`Delete ${title}`}
          onClick={() => onDelete(workspace)}
        >
          Delete
        </button>
      </div>
    </li>
  );
};

interface NewWorkspaceButtonsProps {
  onScratch: () => void;
  busy: boolean;
}

const NewWorkspaceButtons = ({ onScratch, busy }: NewWorkspaceButtonsProps) => (
  <div className="actions">
    <button type="button" className="button button-primary" onClick={onScratch} disabled={busy}>
      Start from scratch
    </button>
    <Link className="button" to="/new/import">
      Import problem
    </Link>
  </div>
);

export const HomePage = () => {
  const { workspaces, persistent } = useLoaderData<typeof homeLoader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);
  const [creating, setCreating] = useState(false);
  const { account, sync } = useSync();

  useEffect(
    () =>
      subscribeToChannel((message) => {
        if (message.type === "changed") void revalidator.revalidate();
      }),
    [revalidator],
  );

  const startScratch = async (): Promise<void> => {
    setCreating(true);
    try {
      const id = await createScratchWorkspace(await getDatabase());
      await navigate(`/w/${id}`);
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (pendingDelete === null) return;
    await deleteWorkspace(await getDatabase(), pendingDelete.id);
    postChannelMessage({ type: "changed", id: pendingDelete.id });
    setPendingDelete(null);
    await revalidator.revalidate();
  };

  const exportOne = async (workspace: Workspace): Promise<void> => {
    await exportWorkspaces(await getDatabase(), [workspace.id]);
  };

  const exportAll = async (): Promise<void> => {
    await exportWorkspaces(await getDatabase());
  };

  const startSync = async (workspace: Workspace): Promise<void> => {
    if (account === null) return;
    await startSyncingWorkspace(await getDatabase(), workspace.id, account.id);
    postChannelMessage({ type: "changed", id: workspace.id });
    sync();
  };

  const copy = async (workspace: Workspace): Promise<void> => {
    if (account === null) return;
    const id = await copyToAccount(await getDatabase(), workspace.id, account.id);
    if (id !== undefined) {
      postChannelMessage({ type: "changed", id });
      sync();
    }
  };

  const synced = pendingDelete !== null && !["local", "excluded"].includes(pendingDelete.syncState);

  return (
    <main className="page">
      <div className="page-heading">
        <h1>My workspaces</h1>
        <div className="actions">
          <Link className="button button-primary" to="/new">
            New workspace
          </Link>
          <Link className="button" to="/new/import">
            Import
          </Link>
          <button
            type="button"
            className="button"
            onClick={() => void exportAll()}
            disabled={workspaces.length === 0}
          >
            Export all
          </button>
          <AccountControl />
        </div>
      </div>

      {account === null && persistent === false && workspaces.length > 0 ? <StorageBanner /> : null}

      {workspaces.length === 0 ? (
        <section className="empty-state" aria-labelledby="empty-heading">
          <h2 id="empty-heading">No workspaces yet</h2>
          <p className="page-intro">
            Start with a blank editor, or bring a problem you want to practise.
          </p>
          <NewWorkspaceButtons onScratch={() => void startScratch()} busy={creating} />
        </section>
      ) : (
        <ul className="workspace-list" aria-label="Workspaces">
          {workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              currentUserId={account?.id ?? null}
              onExport={(target) => void exportOne(target)}
              onDelete={setPendingDelete}
              onStartSync={(target) => void startSync(target)}
              onCopy={(target) => void copy(target)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete === null ? "" : displayTitle(pendingDelete)}”?`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>{synced ? "This also removes it from your other devices." : "This can't be undone."}</p>
      </ConfirmDialog>
    </main>
  );
};
