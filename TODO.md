# TODO

Step-by-step checklist for [PLAN.md](PLAN.md). Each step ends with its gate; don't start the next step until the gate passes. Specs are in [specs/](specs/README.md).

Every code task includes its unit tests (`*.test.ts`, importing from `vite-plus/test`). Run `vp check` and `vp test` before ticking a box.

## Setup

- [ ] Initialise git and make a first commit of the starter.
- [ ] Run `vp install`, `vp check`, `vp test` and `vp build` on the untouched starter to confirm the toolchain works.
- [ ] Add `test` config to `vite.config.ts` (`include: ['src/**/*.test.ts', 'worker/**/*.test.ts']`).
- [ ] Set up Vitest browser mode with `vite-plus/test/browser-playwright` for tests that need Workers, WASM or IndexedDB, as a separate project from the Node tests.
- [ ] Add `src/shared/limits.ts` with every constant from specs/README.md.

## 0. Browser runner proof

Spec: [runner.md](specs/runner.md).

- [ ] Add `src/runner/types.ts`: `RunRequest`, `RunnerTest`, `RunnerEvent`, `RawTestResult`, `ConsoleEntry`, `Runner`, `Encoded`, `CompareTarget`.
- [ ] Write the value encoder (`src/runner/encode.ts`) as a self-contained function that can run inside either runtime: tags, non-serializable detection with path and type, cycle detection, `MAX_RESULT_BYTES` cut-off.
- [ ] Write the console shim with per-test and per-run byte caps.
- [ ] Write the sucrase step: transforms per language, `compile-error` with line and column.
- [ ] Write the harness script: `exports` / `module` / throwing `require`, function lookup, args parsing in-runtime, timing, capture of return value or argument N.
- [ ] Add the fixtures listed under "Step 0 benchmark set".
- [ ] **Candidate A:** QuickJS runner in a module Worker: runtime per run, context per test, memory/stack limits, interrupt deadline, handle disposal.
- [ ] **Candidate B:** native runner: `public/runner.html`, `_headers` CSP, sandboxed iframe, `postMessage` validation, one blob Worker per test, per-test terminate.
- [ ] Page-side watchdog and `stop()` for both candidates.
- [ ] Run the fixture suite against both candidates in Vitest browser mode (Chromium, Firefox, WebKit).
- [ ] Build a throwaway page with a textarea and a Run button to check editor responsiveness during `infinite-loop.js`, and to benchmark on a mid-range Android phone.
- [ ] Verify candidate B's isolation by hand: from user code, `indexedDB.open`, `fetch('/api/me')`, `document.cookie` and `parent.document` all fail, in Chrome, Firefox and Safari.
- [ ] Record the numbers and the decision in `specs/runner-decision.md`; implement `createRunner.ts` for the winner and delete the other candidate.

**Gate:** the chosen runner passes every fixture, `merge-sort-1e6` finishes under 2 s on the phone, and the page stays responsive during a hung run.

## 1. Workspace shell

Specs: [data-model.md](specs/data-model.md), [workspaces-and-import.md](specs/workspaces-and-import.md), [practice-editor.md](specs/practice-editor.md) (routes), [sync-and-auth.md](specs/sync-and-auth.md) (Worker configuration).

- [ ] Add React, React DOM, the React Vite plugin and React Router 7; replace `src/main.ts`, `src/counter.ts` and the starter styles with `src/main.tsx` and the route table. Confirm the plugin works under vite-plus.
- [ ] Add theme tokens (light/dark, `data-theme` on `<html>`) and base layout styles.
- [ ] Add `wrangler.jsonc` with Static Assets (`single-page-application`, `run_worker_first: ["/api/*"]`) and a `worker/index.ts` that answers `GET /api/health`.
- [ ] Try `@cloudflare/vite-plugin` under vite-plus; fall back to `wrangler dev` plus `server.proxy` if it fails. Write down which in a README.
- [ ] Deploy to a staging Worker; check that `/w/anything` serves the app and `/api/health` reaches the Worker.
- [ ] `src/shared/ids.ts`: id generation and identifier validation (with reserved words).
- [ ] `src/db/`: open database `minji` v1 with all stores and indexes; typed helpers per store; the "tests update workspace" and trimming rules.
- [ ] IndexedDB tests with the browser test project (or `fake-indexeddb` in Node).
- [ ] Scratch creation with the defaults table and stub generation.
- [ ] My workspaces screen: sorted list, row fields, empty state, delete with confirmation.
- [ ] Practice route placeholder that loads the workspace and shows its fields read-only, plus the not-found state.
- [ ] Export format: serialise one or all workspaces (valid JSON as values, invalid as strings); download as a file.
- [ ] JSON import: version check, defaults, new ids, multi-workspace selection list.
- [ ] `navigator.storage.persist()` after the first save, and the storage banner.

**Gate:** create a blank workspace, export it, import the file, and reopen both with the same content.

## 2. Editor and tests

Specs: [practice-editor.md](specs/practice-editor.md), [test-cases.md](specs/test-cases.md).

- [ ] Decide the editor (Monaco desktop-first, or CodeMirror 6) and record it in PLAN.md. The rest of this step assumes Monaco.
- [ ] Practice layout with `react-resizable-panels`, persisted sizes, the three width breakpoints, and the statement panel toggle.
- [ ] Monaco with the bundled loader, editor and TS workers only, model per language, compiler options, `runner-globals.d.ts`.
- [ ] Toolbar: title, language switch, function name with validation and stub regeneration, format, font size, theme.
- [ ] Autosave with debounce, flush on hide/pagehide/navigation, retry and save status.
- [ ] Statement rendering (`react-markdown`, `remark-gfm`, `remark-breaks`, no raw HTML, safe links and images) and the notes editor with preview.
- [ ] Test case editor: rows, add, label/args/expected fields, compare select, large-input collapse.
- [ ] Reorder (drag, menu, `Alt+↑/↓`), duplicate, delete with undo.
- [ ] Test validation with the messages table.
- [ ] Revisions: save on `Mod+S`, History drawer, diff view, restore with undo.
- [ ] Reset code with confirmation and revision.
- [ ] Keyboard shortcuts on Monaco and `document`, and the `?` help dialog.
- [ ] Web Lock per workspace, read-only second tab, **Take over**, `BroadcastChannel` change notices.

**Gate:** a user can edit code and test cases, refresh the page, and continue without losing work; a second tab opens read-only.

## 3. Browser runner

Specs: [runner.md](specs/runner.md), [test-cases.md](specs/test-cases.md).

- [ ] Move the chosen runner from the step 0 prototype into `src/runner/`, loaded lazily on the first run.
- [ ] Page-side limit checks before a run (`rejected` outcome).
- [ ] `src/tests/compare.ts` with the comparison rules and difference paths.
- [ ] Map runner events to `TestResult` and `RunRecord`; store runs with trimming; update `lastRun` on Run all only.
- [ ] Save a `run` revision before each run when the code changed.
- [ ] Run all, Run one, `Mod+Enter`, `Mod+Shift+Enter`, Stop, disabled states while running.
- [ ] Results tab: summary text, per-test badges and details, expected/actual with difference highlight, local timing tooltip, `aria-live` announcement.
- [ ] Console tab: per test and grouped, truncation notice.
- [ ] Compile-error and imports-unsupported messages, with "go to line".
- [ ] Error stacks with harness frames removed and line numbers mapped to the user's source.
- [ ] Per-workspace test timeout setting.
- [ ] Re-run the step 0 fixtures through the real UI on desktop browsers and the phone; benchmark first-run download and startup.

**Gate:** every fixture produces a terminal result, and each failure names the test and the reason.

## 4. Problem import

Spec: [workspaces-and-import.md](specs/workspaces-and-import.md).

- [ ] Collect 10 or more real pasted problems (plain text and Markdown, JS and TS starters, single and multiple arguments, in-place, strings with commas) into `src/import/fixtures/`.
- [ ] Title and statement extraction.
- [ ] Starter code extraction, language detection, function name and parameter parsing.
- [ ] Example parsing: example boundaries, Input/Output fields, top-level comma split, `name = value`, JSON with the single-quote retry.
- [ ] Argument ordering by params or by first example, with warnings and `paramsConfirmed`.
- [ ] In-place detection.
- [ ] Import screen: paste tab with starter code field, upload tab with drop zone and size limit.
- [ ] Review screen: editable fields, param chips with remapping, order notice, warnings, test badges, save in one transaction, unsaved-draft prompt.

**Gate:** paste a LeetCode-style statement with examples, review it, and run the extracted tests without fixing any arguments by hand.

## 5. Accounts and finish

Spec: [sync-and-auth.md](specs/sync-and-auth.md).

- [ ] D1 databases for staging and production; `0001_init.sql` migration applied to both.
- [ ] GitHub OAuth apps for staging and production; secrets set with `wrangler secret put`.
- [ ] Worker: session helpers, `Origin` check, error format, structured error logging, Workers Logs enabled.
- [ ] OAuth login, callback, logout, `/api/me`, with tests for state mismatch and expired sessions.
- [ ] Workspace endpoints: pull with cursor, PUT and DELETE with compare-and-swap and sequence numbers, size and type validation.
- [ ] Revision endpoints with idempotent insert and trimming.
- [ ] Daily Cron Trigger that removes tombstones older than 90 days.
- [ ] Client: account control, sign-in/sign-out flow, auth error toasts.
- [ ] Sync loop: Web Lock `sync`, triggers, push, pull table, backoff, status indicator.
- [ ] First sign-in upload prompt, excluded workspaces with **Start syncing**, other-account workspaces with **Copy to this account**.
- [ ] Conflict handling: `conflicts` store, badges, banner, Compare, Keep mine / Keep theirs / Keep both, tombstone cases.
- [ ] Sync badges on the home screen and `Too large to sync` handling.
- [ ] End-to-end tests (Playwright): create → edit → run → refresh; export → import; sign in on two browser contexts and resume; edit on both and resolve the conflict.
- [ ] Accessibility pass: axe on every route, keyboard-only walkthrough, screen-reader check of run announcements.
- [ ] `vp check`, `vp test`, `vp build`, and the end-to-end suite all pass; deploy staging, smoke-test, then deploy production.

**Gate:** sign in on a second device and resume the workspace, tests and saved revisions; editing the same workspace on both devices shows the conflict prompt instead of overwriting.

## Later

- [ ] Problem URL import (needs a per-site adapter; see PLAN.md open decisions).
- [ ] Linked-list and binary-tree test adapters.
- [ ] Class-design problems (method sequence tests).
- [ ] Per-case unordered-array and numeric-tolerance comparison.
- [ ] Service worker for offline use.
- [ ] Tags and folders; more sign-in providers.
