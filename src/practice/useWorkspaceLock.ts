// One editing tab per workspace via the Web Locks API. See specs/data-model.md, "Multi-tab editing".
import { useCallback, useEffect, useRef, useState } from "react";
import { postChannelMessage, subscribeToChannel } from "../shared/channel.ts";

export type LockState = "acquiring" | "held" | "read-only";

const LOCK_RETRY_MS = 100;

interface LockOptions {
  /** Called before giving the lock to another tab; flush pending writes here. */
  beforeRelease: () => Promise<void>;
  /** Called after taking the lock over, so the tab can reload what the other tab saved. */
  afterTakeOver: () => Promise<void>;
}

export const useWorkspaceLock = (
  workspaceId: string,
  { beforeRelease, afterTakeOver }: LockOptions,
): { state: LockState; takeOver: () => void } => {
  const [state, setState] = useState<LockState>(() =>
    typeof navigator.locks === "undefined" ? "held" : "acquiring",
  );
  const release = useRef<(() => void) | null>(null);
  const options = useRef({ beforeRelease, afterTakeOver });
  options.current = { beforeRelease, afterTakeOver };
  const name = `workspace:${workspaceId}`;

  // Holds the lock until `release` is called or the tab goes away.
  const hold = useCallback(
    () =>
      new Promise<void>((resolve) => {
        release.current = () => {
          release.current = null;
          resolve();
        };
      }),
    [],
  );

  useEffect(() => {
    if (typeof navigator.locks === "undefined") return undefined;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A lock released a moment ago (React's StrictMode remount, or leaving another
    // route) can still look taken, so a refusal is retried once before going read-only.
    const tryAcquire = (retriesLeft: number): void => {
      void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
        if (!active) return undefined;
        if (lock === null) {
          if (retriesLeft > 0) retry = setTimeout(() => tryAcquire(retriesLeft - 1), LOCK_RETRY_MS);
          else setState("read-only");
          return undefined;
        }
        setState("held");
        return hold();
      });
    };
    tryAcquire(1);
    const unsubscribe = subscribeToChannel((message) => {
      if (message.type !== "release" || message.id !== workspaceId || release.current === null) {
        return;
      }
      void options.current.beforeRelease().finally(() => {
        release.current?.();
        setState("read-only");
      });
    });
    return () => {
      active = false;
      clearTimeout(retry);
      unsubscribe();
      release.current?.();
    };
  }, [name, workspaceId, hold]);

  const takeOver = useCallback(() => {
    if (typeof navigator.locks === "undefined") return;
    setState("acquiring");
    void navigator.locks.request(name, async () => {
      await options.current.afterTakeOver();
      setState("held");
      return hold();
    });
    postChannelMessage({ type: "release", id: workspaceId });
  }, [name, workspaceId, hold]);

  return { state, takeOver };
};
