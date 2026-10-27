# minji

Personal workspace for practising data structures and algorithms problems in JavaScript and TypeScript. See [PLAN.md](PLAN.md), the [specs](specs/README.md) and the [checklist](TODO.md).

## Development

```bash
vp install
vp dev
```

`vp dev` runs the app and the Cloudflare Worker together: `@cloudflare/vite-plugin` serves `/api/*` from a local workerd runtime, so no separate `wrangler dev` is needed.

| Command                  | What it does                                                            |
| ------------------------ | ----------------------------------------------------------------------- |
| `vp check`               | Format check, lint and type check                                       |
| `vp check --fix`         | Format and apply lint fixes                                             |
| `vp test`                | Unit tests (Node) and runner tests (Chromium, Firefox, WebKit)          |
| `vp test --project unit` | Unit tests only                                                         |
| `vp run build`           | Type-check the app and the Worker, then build                           |
| `vp run deploy:staging`  | Build and deploy to the `minji-staging` Worker (needs `wrangler login`) |

Runner tests need Playwright's browsers once: `node_modules/.bin/playwright install chromium firefox webkit`.

After editing the inline script in `public/runner.html`, update its CSP hash with `vpx ./scripts/update-runner-csp.ts`.
