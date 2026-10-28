// Cloudflare Worker API and daily cleanup. Static assets are served by Workers Static Assets.
import { callback, loginRedirect, logout, sessionUser, type Env } from "./auth.ts";
import {
  deleteRemoteWorkspace,
  getRevisions,
  postRevisions,
  pull,
  putWorkspace,
} from "./workspaces.ts";

export type { Env } from "./auth.ts";

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const error = (code: string, message: string, status: number): Response =>
  json({ error: code, message }, status);
const localHost = (url: URL): boolean =>
  url.hostname === "localhost" || url.hostname === "127.0.0.1";
const githubSecretPattern = /^[a-f\d]{40}$/i;

export const handleRequest = async (
  request: Request,
  env?: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> => {
  const url = new URL(request.url);
  const route = url.pathname;
  let userId: string | null = null;
  let response: Response;
  try {
    if (route === "/api/health" && request.method === "GET") return json({ ok: true });
    if (env?.DB === undefined) return error("unavailable", "The API is not configured.", 503);
    if (route === "/api/auth/github/login" && request.method === "GET") {
      if (
        !env.GITHUB_CLIENT_ID ||
        githubSecretPattern.test(env.GITHUB_CLIENT_ID) ||
        !env.GITHUB_CLIENT_SECRET
      )
        return error("unavailable", "GitHub sign-in is not configured yet.", 503);
      return loginRedirect(request, env);
    }
    if (route === "/api/auth/github/callback" && request.method === "GET")
      return callback(request, env, fetcher);

    const allowedOrigin = localHost(url) ? url.origin : env.APP_ORIGIN;
    if (request.method !== "GET" && request.headers.get("Origin") !== allowedOrigin) {
      response = error("bad_origin", "Request origin is not allowed.", 403);
    } else {
      const user = await sessionUser(request, env);
      if (user === null) response = error("unauthenticated", "Sign in to continue.", 401);
      else {
        userId = user.id;
        if (route === "/api/auth/logout" && request.method === "POST")
          response = await logout(request, env);
        else if (route === "/api/me" && request.method === "GET") response = json(user);
        else if (route === "/api/workspaces" && request.method === "GET")
          response = await pull(request, env, user);
        else {
          const match = /^\/api\/workspaces\/([^/]+)(\/revisions)?$/.exec(route);
          if (match === null) response = error("not_found", "No such API route.", 404);
          else {
            const id = decodeURIComponent(match[1] ?? "");
            const revisions = match[2] !== undefined;
            if (id.length === 0 || id.length > 200)
              response = error("bad_request", "Invalid workspace id.", 400);
            else if (revisions && request.method === "GET")
              response = await getRevisions(env, user, id);
            else if (revisions && request.method === "POST")
              response = await postRevisions(request, env, user, id);
            else if (!revisions && request.method === "PUT")
              response = await putWorkspace(request, env, user, id);
            else if (!revisions && request.method === "DELETE")
              response = await deleteRemoteWorkspace(request, env, user, id);
            else response = error("not_found", "No such API route.", 404);
          }
        }
      }
    }
  } catch (cause) {
    console.error(
      JSON.stringify({
        route,
        status: 500,
        error: "internal",
        userId,
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return error("internal", "Something went wrong. Try again.", 500);
  }
  if (response.status >= 400) {
    const body = (await response.clone().json()) as { error?: string };
    console.error(
      JSON.stringify({ route, status: response.status, error: body.error ?? "unknown", userId }),
    );
  }
  return response;
};

const TOMBSTONE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export const cleanup = async (env: Env, now: number = Date.now()): Promise<void> => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM workspaces WHERE deleted = 1 AND updated_at < ?").bind(
      now - TOMBSTONE_AGE_MS,
    ),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
};

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },
  scheduled(_controller, env, ctx): void {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
