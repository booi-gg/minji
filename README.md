# minji

**Your own LeetCode-style practice space, for your own problems.**

minji is a small, open-source web app for practising coding problems you collect yourself: interview questions, puzzles from a book, exercises from a course, or problems you make up. Paste a problem, write a JavaScript or TypeScript solution, add test cases, and run them in the browser. Your problems stay private to you, work offline, and sync across devices when you sign in.

It's for people who want a personal problem set rather than a public catalog: nothing to browse, no leaderboards, nothing shared unless you export it.

> **Built entirely with AI.** Every line of code, test and spec in this repository was written by AI coding agents, steered and reviewed by a human. The specs in [`specs/`](specs/README.md) and the plans in [`docs/planning/`](docs/planning/) are the contracts it was built from. See [How it was built](#how-it-was-built).

## Features

- **Bring your own problems.** Paste a problem copied from a web page, upload Markdown or text, or import a JSON export. The importer finds the title, starter code, function name, parameters, difficulty and example test cases, then lets you review them before saving.
- **A familiar editor.** Monaco (the editor from VS Code) with TypeScript checking, Prettier formatting and the JetBrains Mono font. The layout follows LeetCode: statement on the left, code on top, **Testcase** and **Test Result** below.
- **Real test cases.** One field per argument, any JSON value, in-place comparisons (an argument after the call), linked list and binary tree adapters, class method sequences, unordered and numeric-tolerance comparison. Results show input, stdout, output and expected value per case.
- **Safe, local execution.** Your code runs in your browser, inside a sandboxed iframe and a Web Worker with a strict Content Security Policy and a watchdog for infinite loops. No code is sent to a server to run.
- **Organize.** Set a difficulty (Easy, Medium, Hard, Super hard) and tags; the problem sidebar searches, sorts by difficulty and filters by tag.
- **Offline first.** Problems live in IndexedDB and a service worker caches the app. History keeps earlier versions of your code, with a side-by-side diff.
- **Optional sync.** Sign in with GitHub to sync problems across devices, with conflict handling when two devices edit the same problem.
- **Cheap to host.** One Cloudflare Worker plus a D1 database, comfortably inside the free plan for personal use.

**Solution languages:** JavaScript and TypeScript. **Hosting:** Cloudflare Workers and D1.

## Quick start

You need [Vite+](https://viteplus.dev/guide/) (the `vp` command), which manages Node.js and pnpm for this project.

```bash
git clone https://github.com/booi-gg/minji.git
cd minji
vp install
vp dev
```

Open `http://localhost:8000`. Everything except sign-in works without further setup; to add sign-in locally, see [Local development with sign-in](docs/self-hosting.md#local-development-with-sign-in).

To run your own copy online, follow [Self-hosting on Cloudflare](docs/self-hosting.md).

## Using minji

- **Add a problem:** **New problem**, then start from scratch or **Import** (paste text, or upload `.md`, `.txt` or `.json`). The import rules are in [specs/workspaces-and-import.md](specs/workspaces-and-import.md).
- **Write tests:** [Writing test cases](docs/writing-tests.md) covers function calls, in-place changes, linked lists and trees, class method sequences and comparison options.
- **Run:** **Run all** (Mod+Enter) runs every valid case; Mod+Shift+Enter runs the selected one.
- **Keep your work:** problems save automatically. **History** shows earlier versions; **Export** downloads a JSON file you can import anywhere.

## Development

| Command                  | What it does                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `vp dev`                 | App and local Worker at `http://localhost:8000`                    |
| `vp check`               | Format check, lint and type check (`vp check --fix` applies fixes) |
| `vp test`                | Unit tests (Node) and runner tests (Chromium, Firefox, WebKit)     |
| `vp test --project unit` | Unit tests only                                                    |
| `vp run build`           | Type-check, build, and generate the offline service worker         |
| `vp run deploy`          | Build and deploy to Cloudflare (needs `vpx wrangler login`)        |

Runner tests need Playwright's browsers once: `node_modules/.bin/playwright install chromium firefox webkit`. End-to-end scripts live in [`scripts/`](scripts/); each documents its usage at the top.

After editing the inline script in `public/runner.html`, update its CSP hash with `vpx ./scripts/update-runner-csp.ts`.

### Project layout

```
src/
  app/         routes, layout, styles, theme
  practice/    the problem page: editor, toolbar, sidebar, autosave, history
  tests/       test case editing, validation, comparison, results
  runner/      sandboxed code runner (iframe + Web Worker), TypeScript stripping
  import/      paste and Markdown parser, JSON export format, review screen
  workspaces/  home list, problem model, difficulty and tags
  sync/        sign-in and the sync engine
  db/          IndexedDB schema and queries
worker/        Cloudflare Worker: GitHub OAuth, sync API, D1 migrations
public/        runner.html (the sandboxed runner), service worker, headers
specs/         behaviour contracts for every part of the app
docs/          guides, and the planning notes the app was built from
```

In the code, a problem is called a **workspace** (`Workspace`, `/w/:id`, the `minji.workspaces` export format); the UI calls it a problem.

## How it was built

minji was built end to end by AI coding agents, with a human deciding what to build and reviewing the result. The process lives in the repository:

1. [`docs/planning/PLAN.md`](docs/planning/PLAN.md) sets the product target and the order of work.
2. [`specs/`](specs/README.md) turns the plan into exact contracts: data model, runner, test cases, editor, import, sync.
3. [`docs/planning/TODO.md`](docs/planning/TODO.md) is the step-by-step checklist; each step has a gate (checks and tests) that passes before the next begins.
4. [`AGENTS.md`](AGENTS.md) holds the instructions every agent session reads, and [`.claude/skills/`](.claude/skills/) holds project skills, such as one that writes importable problem files.

When you change behaviour, change the matching spec in the same pull request; the specs are the source of truth.

## Contributing

Contributions are welcome, written by hand or with an AI agent. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and conventions. To report a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[MIT](LICENSE)
