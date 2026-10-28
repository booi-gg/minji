import { REVISIONS_PER_WORKSPACE, MAX_SYNC_DOC_BYTES } from "../src/shared/limits.ts";
import type { Account, RevisionDto, SyncItem, WorkspaceDoc } from "../src/sync/protocol.ts";
import type { Env } from "./auth.ts";
import { isRevisionDto, isWorkspaceDoc, tooLargeDoc, validBaseRevision } from "./validation.ts";

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const failure = (error: string, message: string, status: number): Response =>
  json({ error, message }, status);
const MAX_REVISION_REQUEST_BYTES = REVISIONS_PER_WORKSPACE * 110_000;

interface WorkspaceRow {
  id: string;
  revision: number;
  seq: number;
  deleted: number;
  doc: string | null;
}
interface RevisionRow {
  id: string;
  language: "javascript" | "typescript";
  source: string;
  reason: "run" | "save";
  created_at: number;
}

const toItem = (row: WorkspaceRow): SyncItem => ({
  id: row.id,
  revision: row.revision,
  seq: row.seq,
  deleted: row.deleted === 1,
  doc: row.doc === null ? null : (JSON.parse(row.doc) as WorkspaceDoc),
});

const rowFor = (env: Env, userId: string, id: string): Promise<WorkspaceRow | null> =>
  env.DB.prepare(
    "SELECT id, revision, seq, deleted, doc FROM workspaces WHERE user_id = ? AND id = ?",
  )
    .bind(userId, id)
    .first<WorkspaceRow>();

const conflict = async (env: Env, userId: string, id: string): Promise<Response> => {
  const row = await rowFor(env, userId, id);
  return json(
    {
      error: "conflict",
      message: "This workspace changed on another device.",
      revision: row?.revision ?? 0,
      doc: row?.doc === null || row === null ? null : (JSON.parse(row.doc) as WorkspaceDoc),
      deleted: row === null || row.deleted === 1,
    },
    409,
  );
};

const readBody = async (
  request: Request,
  maxBytes: number,
): Promise<{ value: unknown } | Response> => {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes)
    return failure("too_large", "The request is too large.", 413);
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return failure("bad_request", "The request must contain valid JSON.", 400);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const pull = async (request: Request, env: Env, user: Account): Promise<Response> => {
  const raw = new URL(request.url).searchParams.get("since") ?? "0";
  const since = Number(raw);
  if (!Number.isSafeInteger(since) || since < 0 || !/^\d+$/.test(raw))
    return failure("bad_request", "Invalid sync cursor.", 400);
  const result = await env.DB.prepare(
    "SELECT id, revision, seq, deleted, doc FROM workspaces WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 101",
  )
    .bind(user.id, since)
    .all<WorkspaceRow>();
  const page = result.results.slice(0, 100);
  return json({
    items: page.map(toItem),
    cursor: page.at(-1)?.seq ?? since,
    more: result.results.length > 100,
  });
};

export const putWorkspace = async (
  request: Request,
  env: Env,
  user: Account,
  id: string,
): Promise<Response> => {
  const body = await readBody(request, MAX_SYNC_DOC_BYTES + 4096);
  if (body instanceof Response) return body;
  if (!isRecord(body.value) || !validBaseRevision(body.value.baseRevision))
    return failure("bad_request", "Invalid base revision.", 400);
  if (tooLargeDoc(body.value.doc))
    return failure("too_large", "The workspace is too large to sync.", 413);
  if (!isWorkspaceDoc(body.value.doc))
    return failure("bad_request", "Invalid workspace document.", 400);
  const base = body.value.baseRevision;
  const doc = JSON.stringify(body.value.doc);
  const now = Date.now();
  let statements: D1PreparedStatement[];
  if (base === 0) {
    statements = [
      env.DB.prepare(
        "UPDATE users SET change_seq = change_seq + 1 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM workspaces WHERE user_id = ? AND id = ?)",
      ).bind(user.id, user.id, id),
      env.DB.prepare(`INSERT INTO workspaces (user_id, id, revision, seq, deleted, doc, updated_at)
        SELECT ?, ?, 1, change_seq, 0, ?, ? FROM users WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM workspaces WHERE user_id = ? AND id = ?)`).bind(
        user.id,
        id,
        doc,
        now,
        user.id,
        user.id,
        id,
      ),
    ];
  } else {
    statements = [
      env.DB.prepare(`UPDATE users SET change_seq = change_seq + 1 WHERE id = ? AND EXISTS
        (SELECT 1 FROM workspaces WHERE user_id = ? AND id = ? AND revision = ? AND deleted = 0)`).bind(
        user.id,
        user.id,
        id,
        base,
      ),
      env.DB.prepare(`UPDATE workspaces SET revision = revision + 1,
        seq = (SELECT change_seq FROM users WHERE id = ?), doc = ?, updated_at = ?
        WHERE user_id = ? AND id = ? AND revision = ? AND deleted = 0`).bind(
        user.id,
        doc,
        now,
        user.id,
        id,
        base,
      ),
    ];
  }
  const results = await env.DB.batch(statements);
  if (results[1]?.meta.changes !== 1) return conflict(env, user.id, id);
  const row = await rowFor(env, user.id, id);
  if (row === null) throw new Error("Saved workspace was not found");
  return json({ revision: row.revision, seq: row.seq });
};

export const deleteRemoteWorkspace = async (
  request: Request,
  env: Env,
  user: Account,
  id: string,
): Promise<Response> => {
  const body = await readBody(request, 4096);
  if (body instanceof Response) return body;
  if (
    !isRecord(body.value) ||
    !validBaseRevision(body.value.baseRevision) ||
    body.value.baseRevision === 0
  )
    return failure("bad_request", "Invalid base revision.", 400);
  const base = body.value.baseRevision;
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET change_seq = change_seq + 1 WHERE id = ? AND EXISTS
      (SELECT 1 FROM workspaces WHERE user_id = ? AND id = ? AND revision = ? AND deleted = 0)`).bind(
      user.id,
      user.id,
      id,
      base,
    ),
    env.DB.prepare(`UPDATE workspaces SET revision = revision + 1,
      seq = (SELECT change_seq FROM users WHERE id = ?), deleted = 1, doc = NULL, updated_at = ?
      WHERE user_id = ? AND id = ? AND revision = ? AND deleted = 0`).bind(
      user.id,
      Date.now(),
      user.id,
      id,
      base,
    ),
    env.DB.prepare(`DELETE FROM revisions WHERE user_id = ? AND workspace_id = ? AND EXISTS
      (SELECT 1 FROM workspaces WHERE user_id = ? AND id = ? AND deleted = 1 AND revision = ?)`).bind(
      user.id,
      id,
      user.id,
      id,
      base + 1,
    ),
  ]);
  if (result[1]?.meta.changes !== 1) return conflict(env, user.id, id);
  const row = await rowFor(env, user.id, id);
  if (row === null) throw new Error("Deleted workspace was not found");
  return json({ revision: row.revision, seq: row.seq });
};

export const getRevisions = async (env: Env, user: Account, id: string): Promise<Response> => {
  const workspace = await rowFor(env, user.id, id);
  if (workspace === null || workspace.deleted === 1)
    return failure("not_found", "Workspace not found.", 404);
  const result =
    await env.DB.prepare(`SELECT id, language, source, reason, created_at FROM revisions
    WHERE user_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(user.id, id, REVISIONS_PER_WORKSPACE)
      .all<RevisionRow>();
  return json({
    items: result.results.map(({ id: revisionId, language, source, reason, created_at }) => ({
      id: revisionId,
      language,
      source,
      reason,
      createdAt: new Date(created_at).toISOString(),
    })),
  });
};

export const postRevisions = async (
  request: Request,
  env: Env,
  user: Account,
  id: string,
): Promise<Response> => {
  const body = await readBody(request, MAX_REVISION_REQUEST_BYTES);
  if (body instanceof Response) return body;
  if (
    !isRecord(body.value) ||
    !Array.isArray(body.value.items) ||
    body.value.items.length > REVISIONS_PER_WORKSPACE ||
    !body.value.items.every(isRevisionDto)
  ) {
    return failure("bad_request", "Invalid revisions.", 400);
  }
  const workspace = await rowFor(env, user.id, id);
  if (workspace === null || workspace.deleted === 1)
    return failure("not_found", "Workspace not found.", 404);
  const items = body.value.items as RevisionDto[];
  const statements = items.map((item) =>
    env.DB.prepare(`INSERT OR IGNORE INTO revisions
    (user_id, id, workspace_id, language, source, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      user.id,
      item.id,
      id,
      item.language,
      item.source,
      item.reason,
      Date.parse(item.createdAt),
    ),
  );
  statements.push(
    env.DB.prepare(`DELETE FROM revisions WHERE user_id = ? AND workspace_id = ? AND id NOT IN
    (SELECT id FROM revisions WHERE user_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT ?)`).bind(
      user.id,
      id,
      user.id,
      id,
      REVISIONS_PER_WORKSPACE,
    ),
  );
  await env.DB.batch(statements);
  return json({ accepted: items.map((item) => item.id) });
};
