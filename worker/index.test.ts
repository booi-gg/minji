import { expect, it } from "vite-plus/test";
import { callback, sessionUser, type Env } from "./auth.ts";
import { handleRequest } from "./index.ts";

const env = (db?: D1Database): Env => ({
  DB: db ?? ({} as D1Database),
  APP_ORIGIN: "https://minji.test",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
});

it("answers the health check", async () => {
  const response = await handleRequest(new Request("https://minji.test/api/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

it("requires a session for API routes", async () => {
  const response = await handleRequest(new Request("https://minji.test/api/workspaces"), env());
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: "unauthenticated" });
});

it("explains when GitHub sign-in has not been configured", async () => {
  const response = await handleRequest(new Request("https://minji.test/api/auth/github/login"), {
    ...env(),
    GITHUB_CLIENT_ID: "",
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: "unavailable" });
});

it("rejects a mismatched OAuth state before contacting GitHub", async () => {
  const response = await callback(
    new Request("https://minji.test/api/auth/github/callback?code=abc&state=wrong", {
      headers: { Cookie: "__Host-oauth_state=right" },
    }),
    env(),
    () => {
      throw new Error("GitHub must not be contacted");
    },
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("https://minji.test/?auth_error=state_mismatch");
});

it("does not authenticate an expired session", async () => {
  const db = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({
          id: "u",
          login: "user",
          avatarUrl: null,
          expires_at: Date.now() - 1,
        }),
      }),
    }),
  } as unknown as D1Database;
  const user = await sessionUser(
    new Request("https://minji.test/api/me", {
      headers: { Cookie: "__Host-session=expired" },
    }),
    env(db),
  );
  expect(user).toBeNull();
});

it("rejects a write from a different origin", async () => {
  const response = await handleRequest(
    new Request("https://minji.test/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://other.test" },
    }),
    env(),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "bad_origin" });
});
