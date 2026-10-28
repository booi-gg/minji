// Cross-tab messages over one BroadcastChannel. See specs/data-model.md, "Multi-tab editing".

export type ChannelMessage =
  | { type: "changed"; id: string }
  | { type: "release"; id: string }
  | { type: "sync-request" };

let channel: BroadcastChannel | undefined;

const getChannel = (): BroadcastChannel | undefined => {
  if (typeof BroadcastChannel === "undefined") return undefined;
  channel ??= new BroadcastChannel("minji");
  return channel;
};

export const postChannelMessage = (message: ChannelMessage): void => {
  getChannel()?.postMessage(message);
  window.dispatchEvent(new CustomEvent("minji:channel", { detail: message }));
};

const isChannelMessage = (data: unknown): data is ChannelMessage =>
  typeof data === "object" &&
  data !== null &&
  "type" in data &&
  (data.type === "sync-request" ||
    ((data.type === "changed" || data.type === "release") &&
      "id" in data &&
      typeof data.id === "string"));

/** Listens for messages from other tabs; returns the unsubscribe function. */
export const subscribeToChannel = (listener: (message: ChannelMessage) => void): (() => void) => {
  const target = getChannel();
  const handler = (event: MessageEvent): void => {
    if (isChannelMessage(event.data)) listener(event.data);
  };
  const localHandler = (event: Event): void => {
    const message = (event as CustomEvent<unknown>).detail;
    if (isChannelMessage(message)) listener(message);
  };
  target?.addEventListener("message", handler);
  window.addEventListener("minji:channel", localHandler);
  return () => {
    target?.removeEventListener("message", handler);
    window.removeEventListener("minji:channel", localHandler);
  };
};
