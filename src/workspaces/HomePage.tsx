import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { getDatabase } from "../db/database.ts";
import { deleteWorkspace, listWorkspaces, saveDraft } from "../db/workspaces.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { postChannelMessage, subscribeToChannel } from "../shared/channel.ts";
import { absoluteTime, relativeTime } from "../shared/format.ts";
import { AccountControl } from "../sync/AccountControl.tsx";
import { useSync } from "../sync/SyncProvider.tsx";
import { copyToAccount, startSyncingWorkspace } from "../sync/store.ts";
import { createScratchWorkspace, exportWorkspaces, isStoragePersistent } from "./actions.ts";
import { displayTitle, type Workspace } from "./model.ts";
import { normalizeFolder, parseTags } from "./organization.ts";
import { StorageBanner } from "./StorageBanner.tsx";
import { useToast } from "../shared/toast.tsx";

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
  onOrganize: (workspace: Workspace) => void;
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
  onOrganize,
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
          {workspace.folder ? <span className="badge">Folder: {workspace.folder}</span> : null}
          {workspace.tags?.map((tag) => (
            <span className="badge" key={tag}>
              #{tag}
            </span>
          ))}
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
        {workspace.ownerId === null || workspace.ownerId === currentUserId ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => onOrganize(workspace)}
          >
            Organize
          </button>
        ) : null}
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
  const showToast = useToast();
  const { workspaces, persistent } = useLoaderData<typeof homeLoader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);
  const [creating, setCreating] = useState(false);
  const [organizing, setOrganizing] = useState<{
    workspace: Workspace;
    folder: string;
    tags: string;
  } | null>(null);
  const [folderFilter, setFolderFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
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
  const folders = [
    ...new Set(workspaces.map((workspace) => workspace.folder ?? "").filter(Boolean)),
  ].sort();
  const tags = [...new Set(workspaces.flatMap((workspace) => workspace.tags ?? []))].sort();
  const visible = workspaces.filter(
    (workspace) =>
      (folderFilter === "all" ||
        (workspace.folder ?? "") === (folderFilter === "unfiled" ? "" : folderFilter.slice(7))) &&
      (tagFilter === "all" || (workspace.tags ?? []).includes(tagFilter.slice(4))),
  );

  const saveOrganization = async (): Promise<void> => {
    if (organizing === null) return;
    const { workspace, folder, tags: tagText } = organizing;
    try {
      await saveDraft(await getDatabase(), workspace.id, {
        folder: normalizeFolder(folder),
        tags: parseTags(tagText),
      });
      postChannelMessage({ type: "changed", id: workspace.id });
      setOrganizing(null);
      await revalidator.revalidate();
    } catch {
      showToast({ message: "Couldn't save this workspace's folder and tags." });
    }
  };

  return (
    <main className="page">
      <div className="page-heading">
        <h1>workspaces</h1>
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
        <>
          <div className="actions organization-filters">
            <label>
              Folder{" "}
              <select
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
              >
                <option value="all">All folders</option>
                <option value="unfiled">Unfiled</option>
                {folders.map((folder) => (
                  <option key={folder} value={`folder:${folder}`}>
                    {folder}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tag{" "}
              <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                <option value="all">All tags</option>
                {tags.map((tag) => (
                  <option key={tag} value={`tag:${tag}`}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {visible.length === 0 ? <p className="hint">No workspaces match these filters.</p> : null}
          <ul className="workspace-list" aria-label="Workspaces">
            {visible.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                currentUserId={account?.id ?? null}
                onExport={(target) => void exportOne(target)}
                onDelete={setPendingDelete}
                onStartSync={(target) => void startSync(target)}
                onCopy={(target) => void copy(target)}
                onOrganize={(target) =>
                  setOrganizing({
                    workspace: target,
                    folder: target.folder ?? "",
                    tags: (target.tags ?? []).join(", "),
                  })
                }
              />
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={organizing !== null}
        title={`Organize “${organizing === null ? "" : displayTitle(organizing.workspace)}”`}
        confirmLabel="Save"
        onConfirm={() => void saveOrganization()}
        onCancel={() => setOrganizing(null)}
      >
        <div className="field">
          <label className="field-label" htmlFor="workspace-folder">
            Folder
          </label>
          <input
            id="workspace-folder"
            maxLength={60}
            value={organizing?.folder ?? ""}
            onChange={(event) =>
              setOrganizing((current) =>
                current === null ? null : { ...current, folder: event.target.value },
              )
            }
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="workspace-tags">
            Tags (comma separated)
          </label>
          <input
            id="workspace-tags"
            value={organizing?.tags ?? ""}
            onChange={(event) =>
              setOrganizing((current) =>
                current === null ? null : { ...current, tags: event.target.value },
              )
            }
          />
        </div>
      </ConfirmDialog>

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
