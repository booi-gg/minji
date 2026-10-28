# minji

Personal workspace for practising data structures and algorithms problems in JavaScript and TypeScript. See [PLAN.md](PLAN.md), the [specs](specs/README.md) and the [checklist](TODO.md).

## Development

```bash
vp install
vp dev
```

`vp dev` runs the app and the Cloudflare Worker together: `@cloudflare/vite-plugin` serves `/api/*` from a local workerd runtime, so no separate `wrangler dev` is needed.

| Command                                               | What it does                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `vp check`                                            | Format check, lint and type check                                       |
| `vp check --fix`                                      | Format and apply lint fixes                                             |
| `vp test`                                             | Unit tests (Node) and runner tests (Chromium, Firefox, WebKit)          |
| `vp test --project unit`                              | Unit tests only                                                         |
| `vp run build`                                        | Type-check, build, and generate the offline service worker              |
| `vp run deploy:staging`                               | Build and deploy to the `minji-staging` Worker (needs `wrangler login`) |
| `vpx ./scripts/e2e-accounts.ts http://localhost:5173` | Account, sync and conflict UI check against a shared test API           |
| `vpx ./scripts/e2e-offline.ts http://localhost:4173`  | Offline check against `vp preview` after a production build             |

Runner tests need Playwright's browsers once: `node_modules/.bin/playwright install chromium firefox webkit`.

After editing the inline script in `public/runner.html`, update its CSP hash with `vpx ./scripts/update-runner-csp.ts`.

## Test cases

Each test can call a function or run a class method sequence. For a class named `Counter`, enter arguments such as `[["Counter","add","get"],[[],[3],[]]]` and expected results `[null,null,3]`. The first `null` is the constructor result; methods that return nothing also produce `null`.

For function tests, choose **Linked list** or **Binary tree** on each argument that needs a node object, then choose the result adapter if the return value (or captured argument) is a node. Enter list values as `[1,2,3]` and trees in level order, such as `[1,null,3]`; an empty structure is `[]`. Each case also has **Ignore outer array order** and an absolute **Numeric tolerance** setting. These settings are saved with the workspace and included in JSON export and sync.

## Offline work and organization

Production builds register a service worker that caches the app and editor for offline use. Workspaces and edits remain in IndexedDB, and account changes sync when the connection returns. The footer shows connection status, pending workspaces, conflicts that need attention, and the last completed sync. On the home screen, use **Organize** to assign a folder and tags, then filter the list by either. Folder and tag values are included in JSON export and account sync. GitHub is the only sign-in provider.

## Account setup and deployment

The D1 databases `minji` and `minji-staging` already exist, and migration `0001_init.sql` has been applied to both. Each Worker needs its own GitHub OAuth app:

| Environment | Homepage URL                                    | Authorization callback URL                                               |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| Staging     | `https://minji-staging.booboosable.workers.dev` | `https://minji-staging.booboosable.workers.dev/api/auth/github/callback` |
| Production  | `https://minji.booboosable.workers.dev`         | `https://minji.booboosable.workers.dev/api/auth/github/callback`         |

Create the apps in GitHub **Settings → Developer settings → OAuth apps**. Put each client ID in its corresponding `GITHUB_CLIENT_ID` value in `wrangler.jsonc`. Set each client secret through Wrangler so it never enters the repository:

```bash
wrangler secret put GITHUB_CLIENT_SECRET --env staging
wrangler secret put GITHUB_CLIENT_SECRET
```

Then run `vp run deploy:staging`. Check `/api/health`, `/w/anything`, sign-in and a sync round trip on staging before `vp run deploy`. The local Playwright check uses a test API and does not need GitHub credentials.
