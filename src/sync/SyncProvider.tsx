import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { getDatabase } from "../db/database.ts";
import { postChannelMessage, subscribeToChannel } from "../shared/channel.ts";
import { SYNC_DEBOUNCE_MS, SYNC_PULL_INTERVAL_MS } from "../shared/limits.ts";
import { useToast } from "../shared/toast.tsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { ApiFailure, getAccount, logOut } from "./api.ts";
import { syncNow, type SyncStatus } from "./engine.ts";
import type { Account } from "./protocol.ts";
import {
  chooseLocalWorkspaces,
  clearCurrentUser,
  pendingLocalWorkspaces,
  setCurrentUser,
} from "./store.ts";

const RETRY_DELAYS = [5000, 15_000, 60_000, 300_000];

interface SyncContextValue {
  account: Account | null;
  loading: boolean;
  status: SyncStatus;
  signOut: () => Promise<void>;
  sync: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export const useSync = (): SyncContextValue => {
  const value = use(SyncContext);
  if (value === null) throw new Error("useSync must be used inside SyncProvider");
  return value;
};

export const SyncProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const showToast = useToast();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [localCount, setLocalCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const pending = useRef(false);
  const retryCount = useRef(0);
  const accountRef = useRef<Account | null>(null);
  const authRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  accountRef.current = account;

  const perform = useCallback(async (): Promise<void> => {
    const user = accountRef.current;
    if (user === null || running.current) {
      pending.current = true;
      return;
    }
    running.current = true;
    let failed = false;
    try {
      await syncNow(await getDatabase(), user.id, setStatus);
      retryCount.current = 0;
    } catch (cause) {
      failed = true;
      if (cause instanceof ApiFailure && cause.status === 401) {
        accountRef.current = null;
        pending.current = false;
        if (timer.current !== null) clearTimeout(timer.current);
        setStatus("signed-out");
        setAccount(null);
        showToast({ message: "Signed out — sign in to keep syncing." });
      } else {
        setStatus("retrying");
        const delay =
          RETRY_DELAYS[Math.min(retryCount.current, RETRY_DELAYS.length - 1)] ?? 300_000;
        retryCount.current += 1;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => void perform(), delay);
      }
    } finally {
      running.current = false;
      if (!failed && pending.current && accountRef.current !== null) {
        pending.current = false;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => void perform(), SYNC_DEBOUNCE_MS);
      }
    }
  }, [showToast]);

  const schedule = useCallback(
    (immediate: boolean): void => {
      if (accountRef.current === null) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void perform(), immediate ? 0 : SYNC_DEBOUNCE_MS);
    },
    [perform],
  );

  useEffect(() => {
    let active = true;
    let attempts = 0;
    const initialize = async (): Promise<void> => {
      const params = new URLSearchParams(window.location.search);
      const authError = params.get("auth_error");
      if (authError !== null) {
        const messages: Record<string, string> = {
          state_mismatch: "Sign-in expired. Please try again.",
          github_denied: "GitHub sign-in was cancelled.",
          github_unavailable: "GitHub sign-in is unavailable. Please try again.",
        };
        showToast({ message: messages[authError] ?? "Sign-in failed. Please try again." });
      }
      if (authError !== null || params.has("signed_in")) {
        params.delete("auth_error");
        params.delete("signed_in");
        const query = params.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${query === "" ? "" : `?${query}`}`,
        );
      }
      try {
        const user = await getAccount();
        if (!active) return;
        const db = await getDatabase();
        await setCurrentUser(db, user.id);
        const pending = await pendingLocalWorkspaces(db);
        if (!active) return;
        accountRef.current = user;
        attempts = 0;
        if (authRetry.current !== null) clearTimeout(authRetry.current);
        setAccount(user);
        setLocalCount(pending.length);
        schedule(true);
      } catch (cause) {
        if (active && (!(cause instanceof ApiFailure) || cause.status !== 401)) {
          if (attempts === 0)
            showToast({ message: "Couldn't check your account. Sync will retry shortly." });
          const delay = RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)] ?? 300_000;
          attempts += 1;
          authRetry.current = setTimeout(() => void initialize(), delay);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    return () => {
      active = false;
      if (authRetry.current !== null) clearTimeout(authRetry.current);
    };
  }, [showToast, schedule]);

  useEffect(() => {
    if (account === null) return;
    const onVisible = (): void => {
      if (document.visibilityState === "visible") schedule(true);
    };
    const onOnline = (): void => schedule(true);
    const unsubscribe = subscribeToChannel((message) => {
      if (message.type === "changed") schedule(false);
      if (message.type === "sync-request") schedule(true);
    });
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") schedule(true);
    }, SYNC_PULL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      unsubscribe();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [account, schedule]);

  const signOut = async (): Promise<void> => {
    await logOut();
    await clearCurrentUser(await getDatabase());
    accountRef.current = null;
    pending.current = false;
    if (timer.current !== null) clearTimeout(timer.current);
    setAccount(null);
    setStatus("idle");
    setLocalCount(0);
    postChannelMessage({ type: "sync-request" });
    await navigate("/");
  };

  const choose = async (upload: boolean): Promise<void> => {
    if (account === null) return;
    await chooseLocalWorkspaces(await getDatabase(), account.id, upload);
    setLocalCount(0);
    schedule(true);
    postChannelMessage({ type: "sync-request" });
  };

  const value = useMemo<SyncContextValue>(
    () => ({ account, loading, status, signOut, sync: () => schedule(true) }),
    [account, loading, status, schedule],
  );
  return (
    <SyncContext value={value}>
      {children}
      <ConfirmDialog
        open={account !== null && localCount > 0}
        title={`Upload ${localCount} ${localCount === 1 ? "workspace" : "workspaces"} from this device?`}
        confirmLabel="Upload"
        cancelLabel="Keep on this device only"
        onConfirm={() => void choose(true)}
        onCancel={() => void choose(false)}
      >
        <p>Upload these workspaces to your account, or keep them on this device only.</p>
      </ConfirmDialog>
    </SyncContext>
  );
};
