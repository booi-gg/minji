import { useState } from "react";
import { Link } from "react-router";

const DISMISSED_KEY = "minji:storageBannerDismissedAt";
const SHOW_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const wasDismissedRecently = (): boolean => {
  try {
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < SHOW_AGAIN_AFTER_MS;
  } catch {
    return false;
  }
};

const rememberDismissal = (): void => {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // Storage is unavailable; the banner simply shows again next time.
  }
};

/** Warns that the browser may evict local data. See specs/data-model.md, "Storage persistence". */
export const StorageBanner = () => {
  const [hidden, setHidden] = useState(wasDismissedRecently);
  if (hidden) return null;

  const dismiss = (): void => {
    rememberDismissal();
    setHidden(true);
  };

  return (
    <aside className="notice" aria-label="Storage warning">
      <p>
        Your browser may clear these workspaces if you don't visit for a while. Use{" "}
        <strong>Export all</strong> to keep a backup.
      </p>
      <div className="actions">
        <Link className="button button-quiet" to="/new/import">
          Restore a backup
        </Link>
        <button type="button" className="button" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </aside>
  );
};
