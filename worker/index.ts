// Cloudflare Worker entry. Static assets are served by Workers Static Assets; only
// /api/* reaches this code (run_worker_first in wrangler.jsonc). See specs/sync-and-auth.md.

export type Env = Record<string, never>;

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export const handleRequest = (request: Request): Response => {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true });
  }
  return json({ error: "not_found", message: "No such API route." }, 404);
};

export default {
  fetch(request): Response {
    return handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
