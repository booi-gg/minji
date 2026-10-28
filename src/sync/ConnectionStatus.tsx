import { useEffect, useState } from "react";
import { absoluteTime, relativeTime } from "../shared/format.ts";
import { useSync } from "./SyncProvider.tsx";

export const ConnectionStatus = () => {
  const {
    account,
    online,
    status,
    lastSyncedAt,
    pendingCount,
    attentionCount,
    hasOfflineAccount,
    sync,
  } = useSync();
  const [, setMinute] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setMinute((minute) => minute + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  let connectionMessage: string | null = null;
  if (!online) connectionMessage = "Sync waits for connection";
  else if (account === null) connectionMessage = "Sign in to sync";
  else if (status === "syncing") connectionMessage = "Syncing…";
  else if (status === "retrying") connectionMessage = "Sync retrying";
  else if (pendingCount === 0) connectionMessage = "Up to date";

  return (
    <div className="connection-status" role="status" aria-live="polite">
      <span
        className={`connection-dot${online ? "" : " connection-dot-offline"}`}
        aria-hidden="true"
      />
      <span>{online ? "Online" : "Offline"}</span>
      {account === null && !hasOfflineAccount ? (
        <span>· Stored on this device</span>
      ) : (
        <>
          {connectionMessage === null ? null : <span>· {connectionMessage}</span>}
          {pendingCount > 0 ? (
            <span>
              · {pendingCount} {pendingCount === 1 ? "workspace needs" : "workspaces need"} sync
            </span>
          ) : null}
          {account !== null && pendingCount > 0 && online && status !== "syncing" ? (
            <button type="button" className="button button-quiet button-small" onClick={sync}>
              Sync now
            </button>
          ) : null}
          {attentionCount > 0 ? <span>· {attentionCount} need attention</span> : null}
          {lastSyncedAt === null ? (
            <span>· Never synced</span>
          ) : (
            <span>
              · Last sync{" "}
              <time dateTime={lastSyncedAt} title={absoluteTime(lastSyncedAt)}>
                {relativeTime(lastSyncedAt)}
              </time>
            </span>
          )}
        </>
      )}
    </div>
  );
};
