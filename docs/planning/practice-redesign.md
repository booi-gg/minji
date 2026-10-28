# Practice workspace redesign

## Goal

Make the practice screen feel like the supplied LeetCode reference: a readable problem on the left, code above tests on the right, a compact case picker, and clear results after a run. Keep Minji's own identity and its user-authored workspace model. The user should be able to understand and run a normal test without seeing every advanced setting at once.

## Why the current screen feels different

The main building blocks already exist: Monaco in `CodeEditor`, two resizable panel groups in `PracticePage`, Markdown statements, local test execution, and saved layouts. The current default gives the statement 30% of the width, the toolbar wraps many controls above the editor, and `TestList` renders a large form for every case. That makes the test area feel like configuration instead of a focused coding workspace. This is a layout and interaction redesign; the runner and sync model can stay in place.

## Desktop layout

```text
┌────────────────────────────── workspace toolbar ──────────────────────────────┐
│ Description / Notes            │ Code · language · function                  │
│                                │ Monaco editor                                 │
│ Problem title                  │                                               │
│ Statement and examples         ├───────────────────────────────────────────────┤
│                                │ Testcase / Test result / Console              │
│                                │ Case 1  Case 2  Case 3  +                     │
│                                │ Named inputs, expected value, case actions   │
└────────────────────────────────┴───────────────────────────────────────────────┘
```

- At widths of at least 1024 px, start near a 46/54 left/right split. Start the right column near a 62/38 code/test split. Keep both splitters draggable and keyboard-operable. Save the new layout under a `v2` key so the existing `v1` sizes do not force the old 30/70 layout.
- Keep the toolbar and each pane header visible while its content scrolls. Each pane scrolls independently; resizing must call Monaco's layout update.
- Use the existing collapse control and `Mod+\` shortcut for the left pane. At 768–1023 px, start with it collapsed. Below 768 px, use the existing one-section-at-a-time navigation and make case controls fit without horizontal scrolling.
- Match the reference's compact spacing, clear panel boundaries, and dark-theme contrast. Preserve the current light and system themes.

## Pane behavior

### Problem pane

- Put the workspace title above the statement, with inline editing where appropriate. Use **Description** and **Notes** tabs. Show folder and tags only when the workspace has them; do not invent difficulty, company, editorial, or community data.
- Keep Markdown examples and HTTPS images readable within the pane. Add a deliberate empty state for scratch workspaces and retain statement editing.

### Code pane and toolbar

- Give the editor a small **Code** header with the JavaScript/TypeScript selector. Infer the function or class entry point from the starter code or a single unambiguous declaration. Keep a manual **Entry point** override in More for workspaces with multiple callables. Keep Monaco's syntax tools, diagnostics, formatting, and shortcuts.
- Keep the primary action **Run all** because it runs the user's visible tests. Show **Stop** while running. Put formatting, reset, history, and other settings in the toolbar without letting them crowd the code.
- Use icon-only toolbar actions from the installed `lucide-react` package: `Play` for Run all, `Square` for Stop, `Paintbrush` for Format, `RotateCcw` for Reset code and Retry, `History` for History, and `Ellipsis` for More. Give each action an accessible name and hover title. Saved/Saving/Failed also use icons with a screen-reader status message.
- Keep the save state visible near the editor. A failed save exposes Retry.

### Testcase pane

- Replace the stacked test cards with a horizontally scrollable **Case 1 / Case 2 / … / +** picker. Show one selected case's editor at a time. Use the case's stable `id` for selection; adding or duplicating selects the new case, and deleting the active case selects a neighbor.
- For an ordinary function test, show one labeled JSON input per parameter (`l1 =`, `l2 =`, `nums =`, `target =`). Fall back to `Argument 1`, etc., when parameter names are unavailable. Show **Expected** as a compact field below the inputs; it is needed to judge a user-authored test.
- Put **Run case**, rename, duplicate, move, and delete near the selected case. Use a small **Options** disclosure for test type, compare target, per-argument adapters, result adapter, unordered outer array, and numeric tolerance. Make the selected non-default options visible as a short summary even when Options is closed.
- Retain a raw JSON view for class method sequences and cases whose argument text cannot be split into fields. Preserve the current large-input editor for very large cases.
- Keep `argsText` and `expectedText` as the stored contract. A top-level JSON-array splitter should map `argsText` into per-parameter draft strings and reassemble it as fields change. It must handle nested arrays, objects, quoted commas, and incomplete edits. If the outer array cannot be split safely, show the raw editor and its validation message. This avoids a database or sync migration while preserving invalid drafts during editing.

### Test result pane

- After a run, select **Test result** and show the summary plus the selected case's status, expected value, actual value, first difference, runtime, or error. Let the user switch between cases without starting another run.
- Keep Console available beside Test result and preserve per-case logs. Use **Passed all N tests** rather than a platform-style submission claim; there is no hidden judge.

## Implementation order

1. **Shell and pane hierarchy:** update `PracticePage.tsx`, `StatementPanel.tsx`, `Toolbar.tsx`, and practice CSS. Give the left pane more space, add the Code header, adjust toolbar placement, and use a new persisted layout key. Verify resizing, scrolling, theme, and saved layout.
2. **Case picker:** refactor `TestList.tsx` into a case strip, selected-case fields, and an Options disclosure. Add the JSON-array splitting utility and focused tests for nested values, strings with commas, incomplete edits, and fallback to raw JSON. Keep existing `TestCase` records and validation behavior.
3. **Results:** update `ResultsPanel.tsx` and `PracticePage.tsx` so a run opens Test result with the relevant case selected. Keep full error and console detail available.
4. **Responsive and accessibility pass:** check keyboard navigation among case tabs, labeled inputs, focus after add/delete, visible focus, screen-reader status announcements, splitter controls, and narrow layouts. Update `specs/practice-editor.md` and `specs/test-cases.md` to describe the shipped behavior.

## Acceptance checks

- At 1440×900, the statement, code, and selected testcase are visible together without the toolbar wrapping over the editor. The user can resize both splits and reopen the page with the same layout.
- A function with parameters `l1` and `l2` shows two input fields. With linked-list adapters, `[2,4,3]` and `[5,6,4]` can be run against expected `[7,0,8]` without editing the raw combined arguments array.
- Existing tests, including class sequences, in-place argument comparison, tree/list adapters, unordered comparison, tolerance, invalid JSON, and large inputs, still load, edit, run, and save correctly.
- Running one case opens its result; running all cases shows the aggregate result; switching case tabs does not rerun code. Import, export, reload, history, autosave, and sync preserve test content.
- `vp check`, `vp test`, and `vp run build` pass, with browser checks at desktop, tablet, and phone widths.
