import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";

interface FakeFetchEvent {
  request: { method: string; mode: string; url: string };
  respondWith: (response: Promise<Response>) => void;
}

it("serves the app and sandboxed runner from the offline cache", async () => {
  const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8")
    .replace("__MINJI_VERSION__", "test")
    .replace("__MINJI_PRECACHE__", "[]");
  const app = new Response("app");
  const runner = new Response("runner");
  const matches: string[] = [];
  let onFetch: ((event: FakeFetchEvent) => void) | undefined;
  runInNewContext(source, {
    self: {
      location: { origin: "https://minji.test" },
      addEventListener: (type: string, listener: unknown) => {
        if (type === "fetch" && typeof listener === "function")
          onFetch = listener as (event: FakeFetchEvent) => void;
      },
    },
    caches: {
      match: async (path: string, options: { ignoreVary: boolean }) => {
        expect(options.ignoreVary).toBe(true);
        matches.push(path);
        return path === "/runner" ? runner : app;
      },
    },
    fetch: async () => {
      throw new Error("offline");
    },
    Response,
    URL,
  });
  if (onFetch === undefined) throw new Error("Service worker did not register its fetch handler");
  const fetchHandler = onFetch;

  const offlineResponse = async (path: string): Promise<Response> => {
    let handled: Promise<Response> | undefined;
    fetchHandler({
      request: { method: "GET", mode: "navigate", url: `https://minji.test${path}` },
      respondWith: (response) => {
        handled = response;
      },
    });
    if (handled === undefined) throw new Error(`No response for ${path}`);
    return handled;
  };

  expect(await (await offlineResponse("/w/saved")).text()).toBe("app");
  expect(await (await offlineResponse("/runner.html")).text()).toBe("runner");
  expect(matches).toEqual(["/", "/runner"]);
});
