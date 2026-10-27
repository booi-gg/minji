import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createAutosaver, type SaveStatus } from "./autosave.ts";

type Change = Record<string, string>;

const setup = (save: (change: Change) => Promise<void>) => {
  const statuses: SaveStatus[] = [];
  const autosaver = createAutosaver<Change>({
    save,
    merge: (older, newer) => ({ ...older, ...newer }),
    delayMs: 500,
    onStatus: (status) => statuses.push(status),
    retryDelaysMs: [1000, 2000],
  });
  return { autosaver, statuses };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("debounces and merges changes into one write", async () => {
  const save = vi.fn(async () => {});
  const { autosaver, statuses } = setup(save);
  autosaver.schedule({ title: "a" });
  await vi.advanceTimersByTimeAsync(300);
  autosaver.schedule({ source: "x" });
  await vi.advanceTimersByTimeAsync(499);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledExactlyOnceWith({ title: "a", source: "x" });
  expect(statuses.at(-1)).toBe("saved");
  expect(autosaver.hasPending()).toBe(false);
});

it("flushes immediately", async () => {
  const save = vi.fn(async () => {});
  const { autosaver } = setup(save);
  autosaver.schedule({ title: "a" });
  await autosaver.flush();
  expect(save).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).toHaveBeenCalledOnce();
});

it("retries failed writes with backoff, keeping newer changes", async () => {
  let fail = true;
  const save = vi.fn(async (_change: Change) => {
    if (fail) throw new Error("disk full");
  });
  const { autosaver, statuses } = setup(save);
  autosaver.schedule({ title: "a" });
  await vi.advanceTimersByTimeAsync(500);
  expect(statuses.at(-1)).toBe("failed");
  expect(autosaver.hasPending()).toBe(true);

  autosaver.schedule({ source: "y" });
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(2);

  fail = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(save).toHaveBeenLastCalledWith({ title: "a", source: "y" });
  expect(statuses.at(-1)).toBe("saved");
});

it("writes one change at a time", async () => {
  const order: string[] = [];
  let release: () => void = () => {};
  const save = vi.fn(async (change: Change) => {
    order.push(`start ${JSON.stringify(change)}`);
    if (change.title === "a") await new Promise<void>((resolve) => (release = resolve));
    order.push(`end ${JSON.stringify(change)}`);
  });
  const { autosaver } = setup(save);
  autosaver.schedule({ title: "a" });
  const first = autosaver.flush();
  autosaver.schedule({ title: "b" });
  const second = autosaver.flush();
  release();
  await Promise.all([first, second]);
  expect(order).toEqual([
    'start {"title":"a"}',
    'end {"title":"a"}',
    'start {"title":"b"}',
    'end {"title":"b"}',
  ]);
});
