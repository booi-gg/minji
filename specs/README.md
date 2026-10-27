# Specs

These specs turn [PLAN.md](../PLAN.md) into buildable contracts. The plan says what to build and in which order; the specs say exactly how each part behaves. [TODO.md](../TODO.md) is the step-by-step checklist.

| Spec                                                 | Covers                                                                                                                | First needed in |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------- |
| [data-model.md](data-model.md)                       | Workspace, test case, revision and run types; IndexedDB layout; export format; storage persistence; multi-tab locking | Step 1          |
| [runner.md](runner.md)                               | Runner interface, message protocol, TypeScript stripping, function lookup, value encoding, sandbox, watchdog          | Step 0          |
| [runner-decision.md](runner-decision.md)             | Step 0 measurements and why the native runner was chosen                                                              | Step 0          |
| [test-cases.md](test-cases.md)                       | Test authoring and validation, comparison rules, result statuses, result UI copy                                      | Step 2          |
| [practice-editor.md](practice-editor.md)             | Routes, practice layout, editor setup, shortcuts, autosave, revisions, reset                                          | Step 1          |
| [workspaces-and-import.md](workspaces-and-import.md) | Home list, new-workspace flow, scratch stub, paste/Markdown/JSON import, review screen                                | Steps 1 and 4   |
| [sync-and-auth.md](sync-and-auth.md)                 | Worker config, D1 schema, `/api/*` endpoints, GitHub OAuth, sessions, sync loop, conflicts                            | Step 5          |

## Shared constants

All limits live in one module, `src/shared/limits.ts`, and both the app and the runner import them.

| Constant                                      | Value        | Notes                                                     |
| --------------------------------------------- | ------------ | --------------------------------------------------------- |
| `MAX_SOURCE_BYTES`                            | 100 000      | UTF-8 bytes of the solution source                        |
| `MAX_TESTS_PER_WORKSPACE`                     | 100          |                                                           |
| `MAX_TEST_INPUT_BYTES`                        | 8 000 000    | Per test, args JSON text; allows 10⁶-element arrays       |
| `MAX_RUN_INPUT_BYTES`                         | 32 000 000   | Sum over the selected tests                               |
| `MAX_RESULT_BYTES`                            | 8 000 000    | Encoded return value per test                             |
| `MAX_CONSOLE_BYTES_PER_TEST`                  | 16 384       | Further output is dropped and marked truncated            |
| `MAX_CONSOLE_BYTES_PER_RUN`                   | 65 536       |                                                           |
| `DEFAULT_TEST_TIMEOUT_MS`                     | 2 000        | Per workspace setting, allowed range 500–10 000           |
| `MIN_TEST_TIMEOUT_MS` / `MAX_TEST_TIMEOUT_MS` | 500 / 10 000 | Range of the per-workspace setting                        |
| `MAX_RUN_TIMEOUT_MS`                          | 30 000       | Total for one run                                         |
| `RUN_OVERHEAD_MS`                             | 5 000        | Added to tests × timeout for the run budget               |
| `WATCHDOG_GRACE_MS`                           | 1 000        | Added to the total cap before the runner is killed        |
| `REVISIONS_PER_WORKSPACE`                     | 20           | Oldest are dropped first                                  |
| `RUNS_PER_WORKSPACE`                          | 10           | Oldest are dropped first                                  |
| `AUTOSAVE_DEBOUNCE_MS`                        | 500          | Local IndexedDB write                                     |
| `SYNC_DEBOUNCE_MS`                            | 3 000        | After local changes settle                                |
| `SYNC_PULL_INTERVAL_MS`                       | 60 000       | While the tab is visible and signed in                    |
| `MAX_SYNC_DOC_BYTES`                          | 1 000 000    | Larger workspaces stay local and show "Too large to sync" |

## Source layout

Feature folders, no barrel files. Tests sit next to the code as `*.test.ts` and import from `vite-plus/test`.

```text
src/
  main.tsx                    React root and router
  shared/limits.ts            constants above
  shared/ids.ts               crypto.randomUUID wrapper, identifier validation
  db/                         IndexedDB open/upgrade, one module per store
  workspaces/                 home list, new-workspace screen, scratch stub
  import/                     paste, Markdown, starter-code and export-format parsers, review screen
  practice/                   practice route, layout, editor, toolbar, autosave
  tests/                      test-case editor, validation, comparison, result views
  runner/                     protocol types, encoder, harness, runner implementations
  sync/                       API client, sync loop, conflict UI
worker/
  index.ts                    Worker entry: routes /api/*
  auth.ts, sessions.ts, workspaces.ts, revisions.ts
  migrations/                 D1 SQL migrations
public/
  runner.html                 sandboxed iframe that hosts the test Workers
```

## Glossary

- **Workspace:** one problem or scratch pad: statement, notes, code, tests, history.
- **Test case:** one set of arguments and one expected value.
- **Run:** one execution of some or all of a workspace's tests against the current source.
- **Revision:** a saved snapshot of the source, taken on run or explicit save.
- **Sync revision:** the server's version number for a synced workspace document; unrelated to code revisions.
- **Runner:** the isolated component that strips types and executes user code.
