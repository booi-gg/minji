# Workspaces and import

## My problems (`/`)

The UI calls workspaces **problems**; see the glossary in README.md.

- Header: heading "problems", **New problem**, icon-only **Import** and **Export all**, and the account control (sign in, or avatar menu with Sign out).
- Rows are sorted by `updatedAt`, newest first, excluding tombstoned workspaces. Each row shows:
  - title, or "Untitled";
  - language;
  - last run: `5/8 passed`, or `Not run yet`;
  - updated time, relative ("3 h ago"), with the exact time in a tooltip;
  - sync badge, only while signed in: `Synced`, `Syncing`, `Conflict`, `Local only`, or `Too large to sync`.
- Row actions: open (click the row), and icon-only **Organize**, **Export**, **Delete**.
- **Delete** asks "Delete "<title>"?" with the detail "This also removes it from your other devices." when the workspace is synced, and "This can't be undone." otherwise.
- Empty state: "No problems yet." with **Start from scratch** and **Import problem** buttons.
- The storage banner from data-model.md appears above the list when it applies.

## New problem (`/new`)

Two choices:

- **Start from scratch** creates the workspace at once and opens `/w/:id`. Title and function name are edited in the practice toolbar.
- **Import problem** goes to `/new/import`.

### Scratch defaults

| Field                         | Value                                   |
| ----------------------------- | --------------------------------------- |
| `title`, `statement`, `notes` | `''`                                    |
| `language`                    | `minji:lastLanguage`, else `typescript` |
| `functionName`                | `solve`                                 |
| `params`                      | `[]`                                    |
| `source`, `starterSource`     | the stub below                          |
| `testTimeoutMs`               | `DEFAULT_TEST_TIMEOUT_MS`               |
| tests                         | none                                    |

Stub, for both languages: `function <functionName>(<params joined by ", ">) {\n  \n}\n`, with the cursor placed on the empty line when the editor opens.

## Import (`/new/import`)

Two tabs:

- **Paste text**: a large textarea for the problem, and an optional **Starter code** textarea.
- **Upload file**: a file picker and drop zone accepting `.md`, `.markdown`, `.txt` and `.json`, at most 10 MB.

**Continue** runs the matching parser and opens the review screen. Parsing never fails outright: anything it can't place stays in the statement and a warning says so.

### Parser output

```ts
interface ImportDraft {
  title: string;
  statement: string;
  language: Language;
  functionName: string;
  params: string[];
  paramsConfirmed: boolean; // false when order was guessed from the examples
  starterSource: string;
  tests: DraftTest[];
  suggestInPlace: boolean;
  warnings: string[];
}

interface DraftTest {
  label: string; // "Example 1"
  args: { name: string | null; text: string }[]; // kept named until saved, so param reordering can remap them
  expectedText: string;
}
```

Parsers live in `src/import/` as pure functions with unit tests on real pasted samples (`src/import/fixtures/`).

### Title

- Markdown: the first `#` heading; it is removed from the statement.
- Paste: the first non-empty line, if it is at most 120 characters and doesn't start with `Example`, `Input` or `Constraints`. A leading `123. ` is stripped. It stays in the statement only if it was not used as the title.
- Otherwise `''`.

### Statement

The whole pasted or uploaded text, minus the line used as the title. Examples and constraints stay in the statement, so nothing is lost. Plain text renders acceptably because the renderer uses `remark-breaks`.

### Starter code

Sources, in order: the **Starter code** textarea; else the first fenced code block tagged `js`, `javascript`, `ts` or `typescript` (that block is removed from the statement); else none.

- **Language:** from the fence tag; otherwise TypeScript when the code has a type annotation on a parameter or return (`/\w\s*\??\s*:\s*[\w[\]<>|, ]+[,)=]/` or `/\)\s*:\s*[\w[\]<>|]+\s*\{/`); otherwise JavaScript. Without starter code, `minji:lastLanguage`.
- **Function name and params:** the first match of `function NAME(PARAMS)`, `(var|let|const) NAME = function (PARAMS)`, or `(var|let|const) NAME = (PARAMS) =>`. Each parameter is reduced to the identifier before any `:`, `?` or `=`. A match sets `paramsConfirmed: true`.
- No starter code: `functionName` is `solve`, `starterSource` is the scratch stub with the params found in the examples.

### Examples

1. An example starts at a line matching `/^\s*(?:#+\s*)?\**\s*Example\s*\d*\s*\**\s*:?/i`.
2. Inside it, `Input:` and `Output:` labels (optionally bold) start fields. A field runs until the next label, `Explanation:`, a blank line, or the next example.
3. **Input** is split on top-level commas, ignoring commas inside brackets, braces or quotes. Each part is `name = value`, or a bare value when there is a single argument.
4. Each value is parsed with `JSON.parse`. If that fails, it is retried with single-quoted strings converted to double-quoted. If that fails too, the raw text is kept and the test is marked invalid on the review screen.
5. **Output** is parsed the same way into `expectedText`.
6. Argument order: with confirmed `params`, arguments are ordered by them, and unknown names produce the warning `Example 2 has an argument "k" that isn't a parameter.` Without, the order of the names in the first example becomes `params`, and `paramsConfirmed` is `false`.

### In-place hint

`suggestInPlace` is `true` when the statement matches `/in[- ]place|do not return anything|modify .* in place/i`. The review screen then offers: "This looks like an in-place problem. Compare argument 1 (nums) after the call?" Accepting sets `compare: { kind: 'argument', index: 0 }` on every imported test.

### JSON files

The export format from data-model.md.

- One workspace: open the full review screen with its fields.
- Several: show a list with a checkbox per workspace (all checked) and **Import selected**. No per-field editing.

## Review screen

Editable fields: title, language, function name, params, statement (rendered, with **Edit raw**), starter code (monospace textarea), and tests (label, arguments, expected, with Valid / Invalid badges).

- **Params** show as chips with **Move left** / **Move right** buttons. Reordering remaps every draft test's named arguments. When `paramsConfirmed` is `false`, a notice reads "Check the parameter order; it was guessed from the examples." and stays until the user reorders or ticks **Order is correct**.
- Warnings are listed at the top.
- **Save problem** creates the workspace and tests in one transaction, with `source` equal to `starterSource`, and opens `/w/:id`. Invalid tests are saved as raw text so the user can fix them in the editor.
- Save is disabled only when title, statement and starter code are all empty.
- Leaving with an unsaved draft asks for confirmation (router blocker and `beforeunload`).
