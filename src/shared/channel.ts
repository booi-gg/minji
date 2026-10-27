// Cross-tab messages over one BroadcastChannel. See specs/data-model.md, "Multi-tab editing".

export type ChannelMessage = { type: "changed"; id: string } | { type: "release"; id: string };

let channel: BroadcastChannel | undefined;

const getChannel = (): BroadcastChannel | undefined => {
  if (typeof BroadcastChannel === "undefined") return undefined;
  channel ??= new BroadcastChannel("minji");
  return channel;
};

export const postChannelMessage = (message: ChannelMessage): void => {
  getChannel()?.postMessage(message);
};

const isChannelMessage = (data: unknown): data is ChannelMessage =>
  typeof data === "object" &&
  data !== null &&
  "type" in data &&
  "id" in data &&
  (data.type === "changed" || data.type === "release") &&
  typeof data.id === "string";

/** Listens for messages from other tabs; returns the unsubscribe function. */
export const subscribeToChannel = (listener: (message: ChannelMessage) => void): (() => void) => {
  const target = getChannel();
  if (target === undefined) return () => {};
  const handler = (event: MessageEvent): void => {
    if (isChannelMessage(event.data)) listener(event.data);
  };
  target.addEventListener("message", handler);
  return () => target.removeEventListener("message", handler);
};
