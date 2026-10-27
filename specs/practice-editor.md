# Routes and practice editor

## Routes

React Router 7 in declarative mode (`BrowserRouter`). The practice route is loaded with `React.lazy`, so Monaco and the runner code stay out of the home-screen bundle.

| Path          | Screen                                   |
| ------------- | ---------------------------------------- |
| `/`           | My workspaces (workspaces-and-import.md) |
| `/new`        | New workspace                            |
| `/new/import` | Import problem and review                |
| `/w/:id`      | Practice                                 |
| anything else | "Page not found" with a link to `/`      |

A missing or deleted workspace id on `/w/:id` shows "This workspace doesn't exist or was deleted." with a link to `/`.

## Layout

Panels use `react-resizable-panels`. Sizes and collapsed state persist in `localStorage` under `minji:layout:v1`.

| Width       | Layout                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1024 px   | Left: **Statement / Notes** tabs (30 %). Right: editor on top (60 %) and a bottom panel with **Tests / Results / Console** tabs (40 %).                        |
| 768–1023 px | Same, with the statement panel collapsed by default.                                                                                                           |
| < 768 px    | Full-width tabs: **Statement**, **Code**, **Tests**, **Results**. Code is read-only until the editor decision in PLAN.md is made; tests can be edited and run. |

The statement panel collapses with a button or `Mod+\`. Resize handles are keyboard-operable (arrow keys) and labelled.

## Toolbar

Left to right: back to workspaces, title (inline edit, placeholder "Untitled"), language select (JavaScript / TypeScript), function name field, **Run all**, **Stop** (only while running), **Reset code**, **Format**, **History**, overflow menu (Export workspace, Test timeout, Font size, Theme, Keyboard shortcuts), save status.

- Function name edits are validated as in data-model.md. If the source still equals `starterSource`, both are regenerated with the new name. Otherwise only the field changes, and the toolbar shows "No function named <name> in your code" when a quick regex check for `function <name>`, `<name> =` or `<name>(` fails.
- Save status shows `Saved`, `Saving…`, or `Couldn't save — Retry`.
- While a run is in progress, **Run all** and every row's **Run** are disabled and show a spinner.

## Editor

- Packages: `monaco-editor` and `@monaco-editor/react`, with `loader.config({ monaco })` so the bundled copy is used and nothing loads from a CDN.
- Workers: register only the editor worker and the TypeScript worker through Vite `?worker` imports in `self.MonacoEnvironment.getWorker`. JSON, CSS and HTML workers are not bundled.
- Model URI is `file:///solution.ts` or `file:///solution.js`. Switching language creates a new model with the same text, keeps the view state (cursor, scroll), and disposes the old model.
- TypeScript defaults: `target` ES2023, `lib: ['es2023']`, `strict: true`, `noEmit: true`, `allowNonTsExtensions: true`. JavaScript keeps Monaco's default of syntax-only diagnostics.
- Add one extra lib, `runner-globals.d.ts`, declaring `console` with `log`, `info`, `warn`, `error` and `debug`. DOM types are not loaded, so `document` or `fetch` show as errors.
- Options: `fontSize` from settings, `minimap` off, `tabSize: 2`, `automaticLayout: true`, `fixedOverflowWidgets: true`, `scrollBeyondLastLine: false`.
- **Format** runs Monaco's `editor.action.formatDocument` (TypeScript's formatter); no Prettier.

## Keyboard shortcuts

`Mod` is `⌘` on macOS and `Ctrl` elsewhere. Shortcuts are registered both as Monaco commands and on `document`, so they work whether or not the editor has focus. The ones marked "outside text fields" are ignored while typing in an input.

| Shortcut                  | Action                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `Mod+Enter`               | Run all                                                      |
| `Mod+Shift+Enter`         | Run the test row that has focus, or the last single-run test |
| `Mod+S`                   | Save a revision (prevents the browser's save dialog)         |
| `Shift+Alt+F`             | Format                                                       |
| `Mod+\`                   | Toggle the statement panel                                   |
| `Alt+↑` / `Alt+↓`         | Move the focused test row                                    |
| `?` (outside text fields) | Show the shortcut list                                       |

## Autosave

- Changes to code, title, notes, language, function name, timeout and tests are written to IndexedDB `AUTOSAVE_DEBOUNCE_MS` after the last change.
- Pending writes are flushed on `visibilitychange` to hidden, on `pagehide`, and before navigating away from the route.
- A failed write retries with backoff (1 s, 2 s, 4 s, then every 10 s) and shows `Couldn't save — Retry`. A `beforeunload` prompt is registered only while a write is pending or failing.
- Autosave never creates revisions.

## Revisions and history

- A revision with `reason: 'run'` is saved before every run, unless the source and language equal the newest revision. `Mod+S` saves one with `reason: 'save'` and shows the toast "Revision saved".
- The **History** drawer lists revisions newest first with time, reason, language, and the pass count of runs that used that revision (`5/8`, or `—`).
- **View** opens a read-only Monaco diff editor: the revision on the left, the current code on the right.
- **Restore** first saves the current code as a `save` revision, then replaces the source and language. The toast offers **Undo**, which restores that just-saved revision.

## Reset code

- Disabled when `source` equals `starterSource`.
- Otherwise asks: "Replace your code with the starter code? Your current code is saved to History first." with **Reset** and **Cancel**.
- On confirm, saves a `save` revision, then sets `source` to `starterSource`.

## Statement and notes

- **Statement** renders `statement` with `react-markdown`, `remark-gfm` and `remark-breaks`. Raw HTML is not rendered (no `rehype-raw`). Links open in a new tab with `rel="noopener noreferrer"`. Images load only from `https:` URLs. An **Edit** button switches to a textarea of the raw text.
- **Notes** is a textarea with a **Preview** toggle that uses the same renderer.
- For scratch workspaces with an empty statement, the left panel opens on **Notes**, and both tabs show a one-line empty state.

## Settings

Stored per device in `localStorage`:

| Key                  | Values                     | Default      |
| -------------------- | -------------------------- | ------------ |
| `minji:theme`        | `system`, `light`, `dark`  | `system`     |
| `minji:fontSize`     | 12–24                      | 14           |
| `minji:lastLanguage` | `javascript`, `typescript` | `typescript` |

The theme sets `data-theme` on `<html>` and the Monaco theme (`vs` or `vs-dark`). The test timeout is per workspace (`testTimeoutMs`) and syncs with it.

## Accessibility

- Every panel has a visible heading or tab label; tabs use the ARIA tab pattern.
- Run summaries are announced through an `aria-live="polite"` region.
- All actions in menus and toolbars are reachable by keyboard, with visible focus.
- Status is never shown by colour alone: badges have text.
- Run axe checks on `/`, `/new`, `/new/import` and `/w/:id` in the end-to-end suite.
