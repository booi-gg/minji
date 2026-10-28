import type { Account } from "../src/sync/protocol.ts";

export interface Env {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  APP_ORIGIN: string;
}

const SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_AGE_SECONDS = 10 * 60;

const randomToken = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
export const hashToken = async (token: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));

const cookieName = (request: Request, purpose: "session" | "oauth_state"): string =>
  new URL(request.url).protocol === "https:" ? `__Host-${purpose}` : purpose;

const appOrigin = (request: Request, env: Env): string => {
  const url = new URL(request.url);
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : env.APP_ORIGIN;
};

export const cookie = (request: Request, name: string): string | null => {
  const pair = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) ?? null;
};

const setCookie = (
  request: Request,
  purpose: "session" | "oauth_state",
  value: string,
  maxAge: number,
): string => {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request, purpose)}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
};
export const clearCookie = (request: Request, purpose: "session" | "oauth_state"): string =>
  setCookie(request, purpose, "", 0);

export const constantTimeEqual = (a: string, b: string): boolean => {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
};

interface SessionRow extends Account {
  expires_at: number;
}

export const sessionUser = async (request: Request, env: Env): Promise<Account | null> => {
  const token = cookie(request, cookieName(request, "session"));
  if (token === null) return null;
  const row =
    await env.DB.prepare(`SELECT users.id, users.login, users.avatar_url AS avatarUrl, sessions.expires_at
    FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.id = ?`)
      .bind(await hashToken(token))
      .first<SessionRow>();
  if (row === null || row.expires_at <= Date.now()) return null;
  return { id: row.id, login: row.login, avatarUrl: row.avatarUrl };
};

export const loginRedirect = (request: Request, env: Env): Response => {
  const state = randomToken();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${appOrigin(request, env)}/api/auth/github/callback`);
  url.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": setCookie(request, "oauth_state", state, OAUTH_AGE_SECONDS),
    },
  });
};

const authRedirect = (env: Env, code: string, request: Request): Response =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `${appOrigin(request, env)}/?auth_error=${code}`,
      "Set-Cookie": clearCookie(request, "oauth_state"),
    },
  });

interface GitHubProfile {
  id: number;
  login: string;
  avatar_url: string | null;
}

export const callback = async (
  request: Request,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const expected = cookie(request, cookieName(request, "oauth_state")) ?? "";
  if (state === "" || expected === "" || !constantTimeEqual(state, expected))
    return authRedirect(env, "state_mismatch", request);
  if (url.searchParams.get("error") !== null) return authRedirect(env, "github_denied", request);
  const code = url.searchParams.get("code");
  if (code === null) return authRedirect(env, "github_denied", request);
  try {
    const tokenResponse = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    if (!tokenResponse.ok) throw new Error("GitHub token exchange failed");
    const tokenData = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof tokenData.access_token !== "string")
      throw new Error("GitHub did not return a token");
    const profileResponse = await fetcher("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "minji",
      },
    });
    if (!profileResponse.ok) throw new Error("GitHub profile request failed");
    const profile = (await profileResponse.json()) as GitHubProfile;
    if (!Number.isSafeInteger(profile.id) || typeof profile.login !== "string")
      throw new Error("Invalid GitHub profile");
    const id = crypto.randomUUID();
    const user =
      await env.DB.prepare(`INSERT INTO users (id, github_id, login, avatar_url, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, avatar_url=excluded.avatar_url RETURNING id`)
        .bind(
          id,
          profile.id,
          profile.login,
          typeof profile.avatar_url === "string" ? profile.avatar_url : null,
          Date.now(),
        )
        .first<{ id: string }>();
    if (user === null) throw new Error("Could not save GitHub account");
    const session = randomToken();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
      .bind(await hashToken(session), user.id, now, now + SESSION_AGE_SECONDS * 1000)
      .run();
    const headers = new Headers({ Location: `${appOrigin(request, env)}/?signed_in=1` });
    headers.append("Set-Cookie", clearCookie(request, "oauth_state"));
    headers.append("Set-Cookie", setCookie(request, "session", session, SESSION_AGE_SECONDS));
    return new Response(null, { status: 302, headers });
  } catch {
    return authRedirect(env, "github_unavailable", request);
  }
};

export const logout = async (request: Request, env: Env): Promise<Response> => {
  const token = cookie(request, cookieName(request, "session"));
  if (token !== null)
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?")
      .bind(await hashToken(token))
      .run();
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookie(request, "session") },
  });
};
