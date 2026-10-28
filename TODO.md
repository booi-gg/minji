# TODO

Step-by-step checklist for [PLAN.md](PLAN.md). Each step ends with its gate; don't start the next step until the gate passes. Specs are in [specs/](specs/README.md).

Every code task includes its unit tests (`*.test.ts`, importing from `vite-plus/test`). Run `vp check` and `vp test` before ticking a box.

## Setup

- [x] Initialise git and make a first commit of the starter.
- [x] Run `vp install`, `vp check`, `vp test` and `vp build` on the untouched starter to confirm the toolchain works.
- [x] Add `test` config to `vite.config.ts` (`include: ['src/**/*.test.ts', 'worker/**/*.test.ts']`).
- [x] Set up Vitest browser mode with `vite-plus/test/browser-playwright` for tests that need Workers, WASM or IndexedDB, as a separate project from the Node tests.
- [x] Add `src/shared/limits.ts` with every constant from specs/README.md.

## 0. Browser runner proof

Spec: [runner.md](specs/runner.md).

- [x] Add `src/runner/types.ts`: `RunRequest`, `RunnerTest`, `RunnerEvent`, `RawTestResult`, `ConsoleEntry`, `Runner`, `Encoded`, `CompareTarget`.
- [x] Write the value encoder (inside the harness, `src/runner/guest.js`) as self-contained code that can run inside either runtime: tags, non-serializable detection with path and type, cycle detection, `MAX_RESULT_BYTES` cut-off.
- [x] Write the console shim with per-test and per-run byte caps.
- [x] Write the sucrase step: transforms per language, `compile-error` with line and column.
- [x] Write the harness script: `exports` / `module` / throwing `require`, function lookup, args parsing in-runtime, timing, capture of return value or argument N.
- [x] Add the fixtures listed under "Step 0 benchmark set".
- [x] **Candidate A:** QuickJS runner in a module Worker: runtime per run, context per test, memory/stack limits, interrupt deadline, handle disposal. (Built, measured, then removed.)
- [x] **Candidate B:** native runner: `public/runner.html`, `<meta>` CSP pinned by hash, sandboxed iframe, `postMessage` validation, one blob Worker per test, per-test terminate.
- [x] Page-side watchdog and `stop()` for both candidates.
- [x] Run the fixture suite against both candidates in Vitest browser mode (Chromium, Firefox, WebKit).
- [x] Build a throwaway page with a textarea and a Run button to check editor responsiveness during `infinite-loop.js` (`src/runner/bench/`). Responsiveness is also asserted in the browser suite.
- [ ] Benchmark on a mid-range Android phone with the bench page (`vp dev --host`, then `/src/runner/bench/`) and add the numbers to `specs/runner-decision.md`.
- [x] Verify candidate B's isolation: from user code, `indexedDB.open`, sync XHR to the app, `importScripts`, `document` and `localStorage` all fail, in Chromium, Firefox and WebKit (automated in the browser suite).
- [ ] Verify that async `fetch` from user code is blocked once the harness supports async results.
- [x] Record the numbers and the decision in `specs/runner-decision.md`; implement `createRunner.ts` for the winner and delete the other candidate.

**Gate:** the chosen runner passes every fixture, `merge-sort-1e6` finishes under 2 s on the phone, and the page stays responsive during a hung run. Desktop parts pass; the phone check is open.

## 1. Workspace shell

Specs: [data-model.md](specs/data-model.md), [workspaces-and-import.md](specs/workspaces-and-import.md), [practice-editor.md](specs/practice-editor.md) (routes), [sync-and-auth.md](specs/sync-and-auth.md) (Worker configuration).

- [x] Add React, React DOM, the React Vite plugin and React Router (8, data mode); replace `src/main.ts`, `src/counter.ts` and the starter styles with `src/main.tsx` and the route table. Confirm the plugin works under vite-plus.
- [x] Add theme tokens (light/dark, `data-theme` on `<html>`) and base layout styles.
- [x] Add `wrangler.jsonc` with Static Assets (`single-page-application`, `run_worker_first: ["/api/*"]`) and a `worker/index.ts` that answers `GET /api/health`.
- [x] Try `@cloudflare/vite-plugin` under vite-plus; fall back to `wrangler dev` plus `server.proxy` if it fails. Write down which in a README.
- [ ] Deploy to a staging Worker; check that `/w/anything` serves the app and `/api/health` reaches the Worker.
- [x] `src/shared/ids.ts`: id generation and identifier validation (with reserved words).
- [x] `src/db/`: open database `minji` v1 with all stores and indexes; typed helpers per store; the "tests update workspace" and trimming rules.
- [x] IndexedDB tests with the browser test project (or `fake-indexeddb` in Node).
- [x] Scratch creation with the defaults table and stub generation.
- [x] My workspaces screen: sorted list, row fields, empty state, delete with confirmation.
- [x] Practice route placeholder that loads the workspace and shows its fields read-only, plus the not-found state.
- [x] Export format: serialise one or all workspaces (valid JSON as values, invalid as strings); download as a file.
- [x] JSON import: version check, defaults, new ids, multi-workspace selection list.
- [x] `navigator.storage.persist()` after the first save, and the storage banner.

**Gate:** create a blank workspace, export it, import the file, and reopen both with the same content.

## 2. Editor and tests

Specs: [practice-editor.md](specs/practice-editor.md), [test-cases.md](specs/test-cases.md).

- [x] Decide the editor and record it in PLAN.md: Monaco, desktop-first.
- [x] Practice layout with `react-resizable-panels`, persisted sizes, the three width breakpoints, and the statement panel toggle.
- [x] Monaco with the bundled loader, editor and TS workers only, model per language, compiler options, `runner-globals.d.ts`.
- [x] Toolbar: title, language switch, function name with validation and stub regeneration, format, font size, theme.
- [x] Prettier formatting (`src/practice/format.ts`): lazy-load `prettier/standalone` with the `babel` and `estree` plugins, `babel`/`babel-ts` parsers, replace Monaco's built-in formatter with a Prettier provider, syntax-error toasts. Unit tests for JS, TS and a syntax error.
- [x] Autosave with debounce, flush on hide/pagehide/navigation, retry and save status.
- [x] Statement rendering (`react-markdown`, `remark-gfm`, `remark-breaks`, no raw HTML, safe links and images) and the notes editor with preview.
- [x] Test case editor: rows, add, label/args/expected fields, compare select, large-input collapse.
- [x] Reorder (drag, up/down buttons, `Alt+↑/↓`), duplicate, delete with undo.
- [x] Test validation with the messages table.
- [x] Revisions: format then save on `Mod+S` (Format on save setting, on by default), History drawer, diff view, restore with undo.
- [x] Reset code with confirmation and revision.
- [x] Keyboard shortcuts on Monaco and `document`, and the `?` help dialog.
- [x] Web Lock per workspace, read-only second tab, **Take over**, `BroadcastChannel` change notices.

**Gate:** a user can edit code and test cases, refresh the page, and continue without losing work; a second tab opens read-only.

## 3. Browser runner

Specs: [runner.md](specs/runner.md), [test-cases.md](specs/test-cases.md).

- [x] Move the chosen runner from the step 0 prototype into `src/runner/`, loaded lazily on the first run.
- [x] Page-side limit checks before a run (`rejected` outcome).
- [x] `src/tests/compare.ts` with the comparison rules and difference paths.
- [x] Map runner events to `TestResult` and `RunRecord`; store runs with trimming; update `lastRun` on Run all only.
- [x] Save a `run` revision before each run when the code changed.
- [x] Run all, Run one, `Mod+Enter`, `Mod+Shift+Enter`, Stop, disabled states while running.
- [x] Results tab: summary text, per-test badges and details, expected/actual with difference highlight, local timing tooltip, `aria-live` announcement.
- [x] Console tab: per test and grouped, truncation notice.
- [x] Compile-error and imports-unsupported messages, with "go to line".
- [x] Error stacks with harness frames removed and line numbers mapped to the user's source.
- [x] Per-workspace test timeout setting (in the editor's More menu; used once tests run).
- [x] Check the gate through the real UI in Chromium, Firefox and WebKit: `vpx ./scripts/e2e-runs.ts <dev server URL>`.
- [ ] Re-run the checks on a phone; benchmark first-run download and startup there.

**Gate:** every fixture produces a terminal result, and each failure names the test and the reason.

## 4. Problem import

Spec: [workspaces-and-import.md](specs/workspaces-and-import.md).

- [x] Collect 10 or more real pasted problems (plain text and Markdown, JS and TS starters, single and multiple arguments, in-place, strings with commas) into `src/import/fixtures/`.
- [x] Title and statement extraction.
- [x] Starter code extraction, language detection, function name and parameter parsing.
- [x] Example parsing: example boundaries, Input/Output fields, top-level comma split, `name = value`, JSON with the single-quote retry.
- [x] Argument ordering by params or by first example, with warnings and `paramsConfirmed`.
- [x] In-place detection.
- [x] Import screen: paste tab with starter code field, upload tab with drop zone and size limit.
- [x] Review screen: editable fields, param chips with remapping, order notice, warnings, test badges, save in one transaction, unsaved-draft prompt.

**Gate:** paste a LeetCode-style statement with examples, review it, and run the extracted tests without fixing any arguments by hand.

**Verified:** the import → review → save → run flow passed in Chromium, Firefox and WebKit with named arguments supplied in a different order from the function parameters.

## 5. Accounts and finish

Spec: [sync-and-auth.md](specs/sync-and-auth.md).

- [x] D1 databases for staging and production; `0001_init.sql` migration applied to both.
- [ ] Create a **staging** GitHub OAuth app in GitHub Settings → Developer settings → OAuth apps. Set homepage to `https://minji-staging.booboosable.workers.dev` and callback to `https://minji-staging.booboosable.workers.dev/api/auth/github/callback`.
- [ ] Create a separate **production** GitHub OAuth app. Set homepage to `https://minji.booboosable.workers.dev` and callback to `https://minji.booboosable.workers.dev/api/auth/github/callback`.
- [ ] Copy each app's client ID into its `GITHUB_CLIENT_ID` entry in `wrangler.jsonc` (staging under `env.staging.vars`, production under `vars`).
- [ ] Set the staging client secret with `wrangler secret put GITHUB_CLIENT_SECRET --env staging` and the production secret with `wrangler secret put GITHUB_CLIENT_SECRET`. Keep both secrets out of the repository.
- [ ] Deploy staging with `vp run deploy:staging`; test GitHub sign-in, sign-out, and a sync round trip. Then deploy production with `vp run deploy` and repeat the sign-in check.
- [x] Worker: session helpers, `Origin` check, error format, structured error logging, Workers Logs enabled.
- [x] OAuth login, callback, logout, `/api/me`, with tests for state mismatch and expired sessions.
- [x] Workspace endpoints: pull with cursor, PUT and DELETE with compare-and-swap and sequence numbers, size and type validation.
- [x] Revision endpoints with idempotent insert and trimming.
- [x] Daily Cron Trigger that removes tombstones older than 90 days.
- [x] Client: account control, sign-in/sign-out flow, auth error toasts.
- [x] Sync loop: Web Lock `sync`, triggers, push, pull table, backoff, status indicator.
- [x] First sign-in upload prompt, excluded workspaces with **Start syncing**, other-account workspaces with **Copy to this account**.
- [x] Conflict handling: `conflicts` store, badges, banner, Compare, Keep mine / Keep theirs / Keep both, tombstone cases.
- [x] Sync badges on the home screen and `Too large to sync` handling.
- [ ] End-to-end tests (Playwright): create → edit → run → refresh; export → import; sign in on two browser contexts and resume; edit on both and resolve the conflict.
- [ ] Accessibility pass: axe on every route, keyboard-only walkthrough, screen-reader check of run announcements.
- [ ] `vp check`, `vp test`, `vp build`, and the end-to-end suite all pass; deploy staging, smoke-test, then deploy production.

**Gate:** sign in on a second device and resume the workspace, tests and saved revisions; editing the same workspace on both devices shows the conflict prompt instead of overwriting.

**Progress:** local API and UI checks pass, including a two-context sync and conflict test with a shared test API. Real GitHub sign-in, a physical second device, manual screen-reader review, and staging/production deployment remain open. The exact OAuth app URLs and secret commands are in [README.md](README.md).

## Later

- [ ] Problem URL import (needs a per-site adapter; see PLAN.md open decisions).
- [x] Linked-list and binary-tree test adapters.
- [x] Class-design problems (method sequence tests).
- [x] Per-case unordered-array and numeric-tolerance comparison.
- [x] Service worker for offline use, including the app shell, editor assets, and sandboxed runner.
- [x] Tags and folders, included in JSON export and account sync.
- [x] Connection and sync status: online/offline, pending workspaces, last sync, and attention needed.
- [ ] Production-preview Playwright smoke test: reload a saved workspace and load the runner while offline. The local sandbox cannot run its browser server (`listen EPERM`); automatic approval review also reached its usage limit.

GitHub remains the only sign-in provider, as requested.
