import { expect, it } from "vite-plus/test";
import { handleRequest } from "./index.ts";

it("answers the health check", async () => {
  const response = handleRequest(new Request("https://minji.test/api/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

it("returns a JSON 404 for unknown API routes", async () => {
  const response = handleRequest(new Request("https://minji.test/api/nope"));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: "not_found" });
});
