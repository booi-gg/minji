# Contributing to minji

Thanks for helping. minji is small on purpose: a private practice space for your own problems, in JavaScript and TypeScript, hosted on Cloudflare. Changes that keep it simple, fast and private are the easiest to accept.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Read the spec for the area you're changing in [`specs/`](specs/README.md). The specs are the source of truth for behaviour.

## Setup

```bash
vp install
vp dev        # http://localhost:8000
```

[Vite+](https://viteplus.dev/guide/) (`vp`) manages Node.js and pnpm; use `vp` instead of `npm`, `yarn` or `pnpm` directly. Runner tests also need Playwright's browsers once: `node_modules/.bin/playwright install chromium firefox webkit`.

## Making a change

1. Branch from `main`.
2. Change the code, and add or update tests next to it (`*.test.ts`, importing from `vite-plus/test`).
3. If the change alters behaviour, update the matching spec in the same pull request.
4. Run the checks:

   ```bash
   vp check --fix   # format, lint, type check
   vp test          # unit and runner tests
   vp run build     # the production build, including the Worker type check
   ```

5. Open a pull request describing what changed and why. Include a screenshot for UI changes.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(sidebar): sort by difficulty` or `fix(runner): allow framing on /runner`.
- **Code style:** whatever `vp check` enforces. Match the surrounding code's naming and comment density; prefer clear names over comments.
- **Naming:** the code calls a problem a `workspace`; the UI calls it a problem. Keep that split, so stored data and export files stay compatible.
- **Stored data:** new fields on a problem are optional, and old exports must still import. Changes to the sync document also need the Worker's validation (`worker/validation.ts`) updated.
- **Runner security:** user code must stay inside the sandboxed iframe and Worker. Don't add `allow-same-origin` to the runner frame or loosen its CSP; see [specs/runner.md](specs/runner.md).

## Working with AI agents

This project was built with AI coding agents, and agent-written contributions are welcome. Agents read [`AGENTS.md`](AGENTS.md) for toolchain instructions, and project skills live in [`.claude/skills/`](.claude/skills/). Review agent output as carefully as your own: run the checks, try the change in the browser, and keep the specs in step.

## Reporting bugs and ideas

Use the issue templates. For security problems, follow [SECURITY.md](SECURITY.md) instead.
