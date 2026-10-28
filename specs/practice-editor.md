# Routes and practice editor

## Routes

React Router 8 in data mode (`createBrowserRouter`, `src/app/router.tsx`), so routes can use loaders and the import screen can block navigation with an unsaved draft. The practice route is loaded with the route's `lazy` option, so Monaco and the runner code stay out of the home-screen bundle.

| Path          | Screen                                   |
| ------------- | ---------------------------------------- |
| `/`           | My workspaces (workspaces-and-import.md) |
| `/new`        | New problem                              |
| `/new/import` | Import problem and review                |
| `/w/:id`      | Practice                                 |
| anything else | "Page not found" with a link to `/`      |

A missing or deleted workspace id on `/w/:id` shows "This workspace doesn't exist or was deleted." with a link to `/`.

## Layout

Panels use `react-resizable-panels`. Sizes and collapsed state persist in `localStorage` under `minji:layout:v1`.

| Width       | Layout                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1024 px   | Left: **Statement / Notes** tabs (30 %). Right: editor on top (60 %) and a bottom panel with **Testcase / Test Result** tabs (40 %).                           |
| 768–1023 px | Same, with the statement panel collapsed by default.                                                                                                           |
| < 768 px    | Full-width tabs: **Statement**, **Code**, **Tests**, **Results**. Code is read-only until the editor decision in PLAN.md is made; tests can be edited and run. |

The statement panel collapses with a button or `Mod+\`. Resize handles are keyboard-operable (arrow keys) and labelled.

## Toolbar

Left to right: back to problems, title (inline edit, placeholder "Untitled"), language select (JavaScript / TypeScript), icon-only **Run all**, **Stop** (only while running), **Reset code**, **Format**, **History**, **More**, and save status. Each icon action has an accessible name and hover title. More contains Entry point, Export problem, Test timeout, Format on save, Font size, Theme, and Keyboard shortcuts.

- A known entry point remains selected while its declaration exists. When the source has exactly one detectable function or class and the stored name is absent, the entry point and parameter names follow the code. More exposes a manual Entry point field for ambiguous source. Function name edits are validated as in data-model.md. Changing the name of an untouched generated scratch stub regenerates that stub; imported starter code is preserved.
- Save status uses an icon with a screen-reader message and hover title for `Saved`, `Saving…`, or `Couldn't save`; a failed save adds an icon-only Retry action.
- While a run is in progress, **Run all** and every row's **Run** are disabled and show a spinner.

## Editor

- Package: `monaco-editor`, bundled (nothing loads from a CDN) and wrapped by a small `CodeEditor` component (`src/practice/CodeEditor.tsx`) instead of `@monaco-editor/react`, so models, read-only state and commands stay under our control. One-time setup lives in `src/practice/monaco.ts`.
- Workers: register only the editor worker and the TypeScript worker through Vite `?worker` imports in `self.MonacoEnvironment.getWorker`. JSON, CSS and HTML workers are not bundled.
- Model URI is `file:///solution.ts` or `file:///solution.js`. Switching language creates a new model with the same text, keeps the view state (cursor, scroll), and disposes the old model.
- TypeScript defaults: `target` ES2023, `lib: ['es2023']`, `strict: true`, `noEmit: true`, `allowNonTsExtensions: true`. JavaScript keeps Monaco's default of syntax-only diagnostics.
- Add one extra lib, `runner-globals.d.ts`, declaring `console` with `log`, `info`, `warn`, `error` and `debug`. DOM types are not loaded, so `document` or `fetch` show as errors.
- Options: `fontSize` from settings, `minimap` off, `tabSize: 2`, `automaticLayout: true`, `fixedOverflowWidgets: true`, `scrollBeyondLastLine: false`.
- **Format** uses Prettier; see Formatting below.

## Keyboard shortcuts

`Mod` is `⌘` on macOS and `Ctrl` elsewhere. Shortcuts are registered both as Monaco commands and on `document`, so they work whether or not the editor has focus. The ones marked "outside text fields" are ignored while typing in an input.

| Shortcut                  | Action                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `Mod+Enter`               | Run all                                                                                          |
| `Mod+Shift+Enter`         | Run the focused case, or the selected case                                                       |
| `Mod+S`                   | Format (when **Format on save** is on), then save a revision; prevents the browser's save dialog |
| `Shift+Alt+F`             | Format with Prettier                                                                             |
| `Mod+\`                   | Toggle the statement panel                                                                       |
| `?` (outside text fields) | Show the shortcut list                                                                           |

## Formatting

The app formats code with Prettier, so the result is the same consistent style everywhere: wrapped long lines, normalised quotes, semicolons and spacing.

- **Loading:** `src/practice/format.ts` dynamically imports `prettier/standalone` with the `babel` and `estree` plugins the first time code is formatted, so the download doesn't slow the first page load. JavaScript uses the `babel` parser and TypeScript the `babel-ts` parser, which avoids loading Prettier's much larger `typescript` plugin.
- **Style:** Prettier defaults (80-character lines, double quotes, semicolons, trailing commas), with `tabWidth: 2` to match the editor. No formatting options in the MVP.
- **Wiring:** turn off Monaco's built-in TypeScript and JavaScript formatting (`documentFormattingEdits`, `documentRangeFormattingEdits` and `onTypeFormattingEdits` set to `false` in the mode configuration) and register Prettier as the document formatting provider for both languages. **Format**, `Shift+Alt+F` and the context menu's **Format Document** then all use Prettier. Monaco reduces the provider's whole-document edit to minimal edits, so the cursor and scroll position stay put.
- **Format on save:** `Mod+S` formats first, then saves the revision. The setting is on by default and lives in the overflow menu. Formatting is one undo step, so `Mod+Z` brings back the unformatted code.
- **When it doesn't run:** autosave never formats (it fires while typing and would move the cursor or rewrite half-typed code), and **Run** never formats (a run shouldn't change your code).
- **Syntax errors:** Prettier can't format code that doesn't parse. **Format** shows the toast "Couldn't format: syntax error on line 4." and leaves the code unchanged. `Mod+S` still saves the revision and shows "Saved without formatting: syntax error on line 4."
- **Read-only editor** (second tab, phone layout): formatting is disabled.

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
| `minji:formatOnSave` | `true`, `false`            | `true`       |

The theme sets `data-theme` on `<html>` and the Monaco theme (`vs` or `vs-dark`). The test timeout is per workspace (`testTimeoutMs`) and syncs with it.

## Accessibility

- Every panel has a visible heading or tab label; tabs use the ARIA tab pattern.
- Run summaries are announced through an `aria-live="polite"` region.
- All actions in menus and toolbars are reachable by keyboard, with visible focus.
- Status is never shown by colour alone: badges have text.
- Run axe checks on `/`, `/new`, `/new/import` and `/w/:id` in the end-to-end suite.
