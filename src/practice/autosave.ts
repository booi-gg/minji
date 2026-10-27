// Debounced, serialised, retrying writes for the practice editor. See specs/practice-editor.md.

export type SaveStatus = "saved" | "saving" | "failed";

export interface Autosaver<T> {
  /** Queues a change; it is written after `delayMs` without further changes. */
  schedule(change: T): void;
  /** Writes any queued change now. */
  flush(): Promise<void>;
  hasPending(): boolean;
}

export interface AutosaverOptions<T> {
  save: (change: T) => Promise<void>;
  /** Combines a queued change with a newer one. */
  merge: (older: T, newer: T) => T;
  delayMs: number;
  onStatus: (status: SaveStatus) => void;
  /** Backoff after a failed write; the last value repeats. */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 10_000] as const;

export const createAutosaver = <T>({
  save,
  merge,
  delayMs,
  onStatus,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
}: AutosaverOptions<T>): Autosaver<T> => {
  let queued: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | undefined;
  let failures = 0;

  const arm = (delay: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void write(), delay);
  };

  const enqueue = (change: T): void => {
    queued = queued === undefined ? change : merge(queued, change);
  };

  const writeOnce = async (): Promise<void> => {
    if (queued === undefined) return;
    const change = queued;
    queued = undefined;
    try {
      await save(change);
      failures = 0;
      if (queued === undefined) onStatus("saved");
    } catch {
      // Put the change back in front of anything queued since.
      queued = queued === undefined ? change : merge(change, queued);
      onStatus("failed");
      const delay = retryDelaysMs[Math.min(failures, retryDelaysMs.length - 1)] ?? delayMs;
      failures += 1;
      // Retries continue after the page unmounts, so a failed write isn't dropped.
      arm(delay);
    }
  };

  // Writes run one at a time, in order.
  const write = async (): Promise<void> => {
    timer = undefined;
    while (writing !== undefined) await writing;
    writing = writeOnce();
    try {
      await writing;
    } finally {
      writing = undefined;
    }
  };

  return {
    schedule(change: T): void {
      enqueue(change);
      onStatus("saving");
      arm(delayMs);
    },
    flush(): Promise<void> {
      clearTimeout(timer);
      return write();
    },
    hasPending(): boolean {
      return queued !== undefined || writing !== undefined;
    },
  };
};
