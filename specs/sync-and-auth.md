# Sync, accounts and the Worker

## Worker configuration

`wrangler.jsonc` at the project root:

```jsonc
{
  "name": "minji",
  "main": "worker/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "minji",
      "database_id": "<prod id>",
      "migrations_dir": "worker/migrations",
    },
  ],
  "vars": {
    "GITHUB_CLIENT_ID": "<prod client id>",
    "APP_ORIGIN": "https://minji.<account>.workers.dev",
  },
  "env": {
    "staging": {
      "name": "minji-staging",
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "minji-staging",
          "database_id": "<staging id>",
          "migrations_dir": "worker/migrations",
        },
      ],
      "vars": {
        "GITHUB_CLIENT_ID": "<staging client id>",
        "APP_ORIGIN": "https://minji-staging.<account>.workers.dev",
      },
    },
  },
}
```

- `GITHUB_CLIENT_SECRET` is set with `wrangler secret put` per environment, never committed. Each environment has its own GitHub OAuth app, because the callback URL differs.
- Local development uses `@cloudflare/vite-plugin` inside `vite.config.ts`, which serves the assets and the Worker from `vp dev` with a local D1. If the plugin doesn't work under vite-plus, run `wrangler dev` beside `vp dev` and proxy `/api` to it with `server.proxy`. Record which in the README.
- `public/_headers` sets, for every page, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: DENY` except on `/runner.html`, which carries its own CSP in a `<meta>` tag (runner.md).

## D1 schema

`worker/migrations/0001_init.sql`:

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,           -- random UUID
  github_id   INTEGER NOT NULL UNIQUE,
  login       TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  INTEGER NOT NULL,           -- epoch ms
  change_seq  INTEGER NOT NULL DEFAULT 0  -- last sequence number handed out for this user
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- SHA-256 hex of the session token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE workspaces (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,              -- client-generated workspace id
  revision    INTEGER NOT NULL,           -- sync revision, starts at 1
  seq         INTEGER NOT NULL,           -- users.change_seq at last change, for pulls
  deleted     INTEGER NOT NULL DEFAULT 0,
  doc         TEXT,                       -- JSON WorkspaceDoc; NULL once deleted
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX workspaces_user_seq ON workspaces(user_id, seq);

CREATE TABLE revisions (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  language     TEXT NOT NULL,
  source       TEXT NOT NULL,
  reason       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX revisions_workspace ON revisions(user_id, workspace_id, created_at);
```

## Synced document

```ts
interface WorkspaceDoc {
  title: string;
  statement: string;
  notes: string;
  language: Language;
  functionName: string;
  params: string[];
  source: string;
  starterSource: string;
  testTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  tests: {
    id: string;
    position: number;
    label: string;
    argsText: string;
    expectedText: string;
    compare: CompareTarget;
  }[];
}
```

The client builds it from IndexedDB, and checks that `JSON.stringify(doc)` is at most `MAX_SYNC_DOC_BYTES` UTF-8 bytes; if not, the workspace is marked `too-large` and skipped. The server validates the same limit and the field types and rejects with `413` or `400`.

## API

All responses are JSON. Errors use `{ "error": "<code>", "message": "<human text>" }`. Every endpoint except the OAuth redirects requires a valid session (`401 unauthenticated` otherwise). Every non-`GET` request must carry an `Origin` header equal to `APP_ORIGIN` (`403 bad_origin` otherwise).

| Method and path                            | Request                                       | Success                                                    | Errors                                                            |
| ------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /api/auth/github/login`               | —                                             | `302` to GitHub authorize URL                              | —                                                                 |
| `GET /api/auth/github/callback?code&state` | —                                             | `302` to `/?signed_in=1` with session cookie               | `302` to `/?auth_error=<code>`                                    |
| `POST /api/auth/logout`                    | —                                             | `204`, cookie cleared, session row deleted                 | —                                                                 |
| `GET /api/me`                              | —                                             | `200 { id, login, avatarUrl }`                             | `401`                                                             |
| `GET /api/workspaces?since=<seq>`          | —                                             | `200 { items: SyncItem[], cursor: number, more: boolean }` | —                                                                 |
| `PUT /api/workspaces/:id`                  | `{ baseRevision: number, doc: WorkspaceDoc }` | `200 { revision, seq }`                                    | `409 { error: 'conflict', revision, doc, deleted }`, `400`, `413` |
| `DELETE /api/workspaces/:id`               | `{ baseRevision: number }`                    | `200 { revision, seq }`                                    | `409` as above                                                    |
| `GET /api/workspaces/:id/revisions`        | —                                             | `200 { items: RevisionDto[] }`, newest first, at most 20   | `404`                                                             |
| `POST /api/workspaces/:id/revisions`       | `{ items: RevisionDto[] }` (at most 20)       | `200 { accepted: string[] }`                               | `404`, `413`                                                      |

```ts
interface SyncItem {
  id: string;
  revision: number;
  seq: number;
  deleted: boolean;
  doc: WorkspaceDoc | null;
}
interface RevisionDto {
  id: string;
  language: Language;
  source: string;
  reason: "run" | "save";
  createdAt: string;
}
```

### Server rules

- **Sequence numbers:** each write runs as one `DB.batch` that first does `UPDATE users SET change_seq = change_seq + 1 WHERE id = ? RETURNING change_seq` and stores that value in the row's `seq`.
- **PUT with `baseRevision` 0:** insert with `revision = 1`. If the row exists, respond `409` with the stored row.
- **PUT with `baseRevision` > 0:** `UPDATE … SET revision = revision + 1, … WHERE user_id = ? AND id = ? AND revision = ? AND deleted = 0`. Zero changed rows means `409` with the stored row (which may be a tombstone).
- **DELETE:** same compare-and-swap; sets `deleted = 1`, `doc = NULL`, deletes the workspace's revisions.
- **Pull:** `SELECT … WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 100`; `more` is `true` when 100 rows came back, and `cursor` is the last row's `seq`.
- **Revisions:** insert with `INSERT OR IGNORE` (ids are client-generated, so retries are safe), then delete all but the newest `REVISIONS_PER_WORKSPACE` for that workspace.
- Tombstones are kept for 90 days, then removed by a scheduled cleanup (a Cron Trigger once a day). A device that has been offline longer than that does a full resync (see below).

## GitHub OAuth

1. **Login:** generate 32 random bytes as `state`, set cookie `__Host-oauth_state` (`Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`), redirect to `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=<APP_ORIGIN>/api/auth/github/callback&state=…`. No scopes are requested; the public profile is enough.
2. **Callback:** compare the `state` query value with the cookie in constant time, clear the cookie, exchange `code` at `https://github.com/login/oauth/access_token`, fetch `https://api.github.com/user`, and upsert the user by `github_id` (updating `login` and `avatar_url`). The GitHub access token is discarded after this request.
3. **Session:** create 32 random bytes as the token, store its SHA-256 hex in `sessions` with `expires_at` 30 days ahead, and set `__Host-session=<token>; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`.
4. **Lookup:** hash the cookie token and select an unexpired session. Sessions don't slide; the user signs in again after 30 days.
5. **Logout:** delete the session row and clear the cookie.

Error codes passed back as `auth_error`: `state_mismatch`, `github_denied`, `github_unavailable`. The home screen shows a toast for each.

## Client sync

`src/sync/` runs only while signed in. `meta.currentUserId` records the account.

### Triggers

- A workspace becomes `dirty`: push it `SYNC_DEBOUNCE_MS` after its last local change.
- A run starts, or `Mod+S`: push immediately.
- Tab becomes visible, `online` fires, sign-in completes, or every `SYNC_PULL_INTERVAL_MS` while visible: pull, then push anything dirty.
- Only one sync loop runs across tabs: it holds the Web Lock `sync`; other tabs ask it to sync via the `BroadcastChannel`.

### Which workspaces sync

Those with `ownerId === currentUserId`, or `ownerId === null` after the user agreed to upload them. `excluded` workspaces never sync.

### Push

For each `dirty` workspace: `PUT` with `baseRevision = syncRevision`. On `200`, set `syncRevision`, `syncState: 'synced'`, `ownerId`. Then `POST` its unsynced revisions and mark the accepted ones `synced`. For a tombstoned workspace, send `DELETE` instead and purge it locally on `200`.

If the workspace changed locally while the request was in flight (`updatedAt` moved), it stays `dirty` and is pushed again.

### Pull

`GET /api/workspaces?since=<syncCursor>`, repeated while `more` is `true`, then store the new cursor. For each item:

| Local state           | Remote item                      | Result                                                                                                     |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| absent                | live                             | create locally as `synced`                                                                                 |
| absent                | deleted                          | ignore                                                                                                     |
| `synced`              | live, higher revision            | replace local fields and tests                                                                             |
| `synced`              | deleted                          | purge locally; if it's open, show "This workspace was deleted on another device." and go home              |
| `dirty` or `conflict` | higher revision, live or deleted | mark `conflict`, store the remote copy in the `conflicts` store (replacing any older one), don't overwrite |
| any                   | revision ≤ local `syncRevision`  | ignore (already have it)                                                                                   |

A `409` from a push is handled like the `dirty` row above.

### Conflicts

The practice screen and the home row show a `Conflict` badge. The practice screen shows a banner: "This workspace changed on another device." with **Compare**, **Keep mine**, **Keep theirs**, **Keep both**.

- **Compare** opens a Monaco diff of the code (theirs left, mine right) and lists test changes (added, removed, changed).
- **Keep mine:** `PUT` the local doc with `baseRevision` set to the server's revision. If the remote was a tombstone, `PUT` with `baseRevision: 0` under a new id instead, since the old id is deleted.
- **Keep theirs:** save the local code as a `save` revision, then overwrite local fields and tests with the server doc and mark `synced`. If the remote was a tombstone, delete locally.
- **Keep both:** copy the local workspace to a new id titled "<title> (copy)", mark it `dirty`, then apply **Keep theirs** to the original.

Editing continues while a conflict is pending; edits apply to "mine".

### Sign-in and sign-out

- **First sign-in on a device** with workspaces whose `ownerId` is `null` and `syncState` is `local`: ask "Upload 4 workspaces from this device to your account?" with **Upload** and **Keep on this device only**. Upload marks them `dirty`; the other choice marks them `excluded`. An excluded workspace has **Start syncing** in its row menu.
- **Sign-out:** call logout, clear `currentUserId` and `syncCursor`, and keep all local data. Synced workspaces stay visible, editable and marked `Local only` until the same account signs in again.
- **Different account:** workspaces whose `ownerId` belongs to another account are shown with "From another account" and never sync. The user can **Copy to this account**, which duplicates them with `ownerId: null`.
- **Full resync:** when the cursor is `0` or the last pull was more than 80 days ago, pull from `0` and reconcile by id with the table above.

## Errors and logging

- Network and `5xx` failures retry with backoff (5 s, 15 s, 60 s, then every 5 min) and show a small "Sync paused — retrying" indicator on the home header. `401` stops syncing and shows "Signed out — sign in to keep syncing".
- The Worker logs one structured line per failed request (`{ route, status, error, userId }`) with `console.error`; Workers Logs keeps them. Turn on Workers Logs in `wrangler.jsonc` (`"observability": { "enabled": true }`).
