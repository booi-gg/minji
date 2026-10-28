# Self-hosting on Cloudflare

minji runs as one Cloudflare Worker: it serves the built app as static assets and handles `/api/*` (sign-in and sync) backed by a D1 database. Everything fits in Cloudflare's free plan for personal use.

Accounts are optional. Without the GitHub OAuth step, the app still works fully in the browser: problems live in IndexedDB on that device, and you can move them with **Export** / **Import**. Sign-in adds sync across devices.

## What you need

- A Cloudflare account, and Wrangler signed in: `vpx wrangler login`.
- A GitHub account, for the OAuth app (only if you want sign-in and sync).
- The project installed: `vp install`.

## 1. Create the database

```bash
vpx wrangler d1 create minji
```

Copy the printed `database_id` into the top-level `d1_databases` entry in `wrangler.jsonc`, then create the tables:

```bash
vpx wrangler d1 migrations apply minji --remote
```

## 2. Point the Worker at its address

The Worker's address is `https://<worker name>.<your subdomain>.workers.dev`. The name is `minji` (the `name` field in `wrangler.jsonc`); your subdomain is shown under **Workers & Pages** in the Cloudflare dashboard. Set `vars.APP_ORIGIN` in `wrangler.jsonc` to that address. The Worker only accepts API requests from this origin.

## 3. Set up GitHub sign-in (optional)

In GitHub, open **Settings → Developer settings → OAuth apps → New OAuth app**:

| Field                      | Value                                   |
| -------------------------- | --------------------------------------- |
| Homepage URL               | your `APP_ORIGIN`                       |
| Authorization callback URL | `<APP_ORIGIN>/api/auth/github/callback` |

Put the app's **Client ID** in `vars.GITHUB_CLIENT_ID` in `wrangler.jsonc`. Generate a client secret and store it as a Worker secret, so it never enters the repository:

```bash
vpx wrangler secret put GITHUB_CLIENT_SECRET
```

The Client ID (it starts with `Ov23` for new OAuth apps) is public. The client secret is a 40-character hex string; if a secret-shaped value is put in `GITHUB_CLIENT_ID` by mistake, the Worker refuses to start sign-in. If a secret ever lands in a commit, a chat or a URL, regenerate it in GitHub.

## 4. Deploy

```bash
vp run deploy
```

Then check:

- `<APP_ORIGIN>/api/health` returns `{"ok":true}`.
- A deep link such as `<APP_ORIGIN>/w/anything` loads the app (and shows "Problem not found").
- Running a problem's tests works (the sandboxed runner frame loads).
- Signing in, editing a problem, and opening it on a second device syncs it.

A daily cron trigger (`0 3 * * *`) removes expired sessions and the server's records of problems deleted long ago.

## Staging (optional)

`wrangler.jsonc` also defines an `env.staging` Worker (`minji-staging`) with its own D1 database and OAuth app. To use it, repeat steps 1–3 with `--env staging` on each Wrangler command (`wrangler d1 create minji-staging`, `wrangler d1 migrations apply minji-staging --remote --env staging`, `wrangler secret put GITHUB_CLIENT_SECRET --env staging`), fill in the staging values, and deploy with `vp run deploy:staging`. If you don't need staging, delete the `env` block.

## Local development with sign-in

`vp dev` runs the Worker locally together with the app, using a local D1 database. For sign-in on `http://localhost:8000`, create a second OAuth app with homepage `http://localhost:8000` and callback `http://localhost:8000/api/auth/github/callback`, then copy [`.dev.vars.example`](../.dev.vars.example) to `.dev.vars` and fill it in. `.dev.vars` is git-ignored.
