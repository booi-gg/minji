# Data model

## Types

All timestamps are ISO 8601 strings in UTC. All ids come from `crypto.randomUUID()`.

```ts
type Language = "javascript" | "typescript";

type SyncState =
  | "local" // never uploaded; not tied to an account
  | "excluded" // user chose to keep it on this device only
  | "dirty" // has local changes not yet accepted by the server
  | "synced" // matches the server at syncRevision
  | "conflict" // server changed while local was dirty; waiting on the user
  | "too-large"; // document exceeds MAX_SYNC_DOC_BYTES

interface Workspace {
  id: string;
  title: string; // '' shows as "Untitled"
  statement: string; // Markdown, rendered without raw HTML
  notes: string; // Markdown, user-owned
  language: Language;
  functionName: string; // valid JS identifier, see "Validation"
  params: string[]; // parameter names, used for test labels and the scratch stub
  source: string;
  starterSource: string; // what Reset code restores
  testTimeoutMs: number; // DEFAULT_TEST_TIMEOUT_MS unless changed
  createdAt: string;
  updatedAt: string; // any user-visible change, including tests
  deletedAt: string | null; // tombstone; hidden from the UI when set
  ownerId: string | null; // user id once synced; null while local
  syncRevision: number; // 0 until the server first accepts it
  syncState: SyncState;
  lastRun: { passed: number; total: number; at: string } | null; // from the last "Run all"
}

type CompareTarget = { kind: "return" } | { kind: "argument"; index: number }; // value of args[index] after the call

interface TestCase {
  id: string;
  workspaceId: string;
  position: number; // 0-based, dense; rewritten on reorder
  label: string; // optional, '' when unset
  argsText: string; // raw editor text; must parse to a JSON array to run
  expectedText: string; // raw editor text; JSON plus the tags in runner.md
  compare: CompareTarget;
  kind?: "function" | "class"; // defaults to function for older records
  inputAdapters?: ("plain" | "linked-list" | "binary-tree")[];
  outputAdapter?: "plain" | "linked-list" | "binary-tree";
  comparison?: { unordered?: boolean; tolerance?: number };
}

interface Revision {
  id: string;
  workspaceId: string;
  language: Language;
  source: string;
  reason: "run" | "save";
  createdAt: string;
  synced: boolean;
}

interface RunRecord {
  id: string;
  workspaceId: string;
  scope: "all" | "single";
  startedAt: string;
  durationMs: number;
  revisionId: string | null; // revision taken for this run, if any
  outcome: RunOutcome; // see test-cases.md
  results: TestResult[]; // see test-cases.md
}
```

Test cases keep raw text so a half-typed, invalid case survives a refresh. Parsed values are derived when needed and never stored.

## Validation

- `functionName` matches `^[A-Za-z_$][A-Za-z0-9_$]*$` and is not a reserved word (`function`, `class`, `return`, `default`, and the rest of the ES reserved list). It is interpolated into the harness, so validation is a security check, not just UX.
- `params` entries follow the same identifier rule. They are display names only; the runner passes arguments positionally.
- `source` is at most `MAX_SOURCE_BYTES`. The editor shows a warning at 90 % and blocks runs above the limit.
- A workspace has at most `MAX_TESTS_PER_WORKSPACE` tests. The add button disables at the limit.

## IndexedDB

Database `minji`, version 1, opened through the `idb` package.

| Store        | Key           | Indexes                                  |
| ------------ | ------------- | ---------------------------------------- |
| `workspaces` | `id`          | `updatedAt`, `syncState`                 |
| `test_cases` | `id`          | `workspaceId`, `[workspaceId, position]` |
| `revisions`  | `id`          | `[workspaceId, createdAt]`               |
| `runs`       | `id`          | `[workspaceId, startedAt]`               |
| `conflicts`  | `workspaceId` | —                                        |
| `meta`       | `key`         | —                                        |

`meta` holds `syncCursor`, `lastPullAt`, `currentUserId`, and `persistRequested`. `conflicts` holds `{ workspaceId, remoteRevision, deleted, doc }` for each workspace in `conflict` state, so a pending conflict survives a refresh (see sync-and-auth.md); the row is removed when the conflict is resolved.

Rules:

- Any write that changes tests also updates `workspaces.updatedAt` in the same transaction, and marks a synced workspace `dirty`.
- Revisions and runs are trimmed to `REVISIONS_PER_WORKSPACE` and `RUNS_PER_WORKSPACE` in the same transaction that adds one. Unsynced revisions are trimmed like any other; the server keeps its own cap.
- A new revision is skipped when its `source` and `language` equal the newest revision's.
- Deleting a workspace sets `deletedAt` and `updatedAt`. If `syncState` is `local` or `excluded`, the workspace, its tests, revisions and runs are removed at once. Otherwise they are removed after the server acknowledges the tombstone.
- Schema changes bump the database version and migrate in `upgrade`; never edit version 1 after release.

## Storage persistence

After the first workspace is saved, call `navigator.storage.persist()` once, in the background, and record `persistRequested` in `meta`. Never wait for the answer: Firefox shows a permission prompt and the promise only settles when the user responds. If it returns `false` and the user is signed out, show a dismissible banner on the home screen: "Your browser may clear these workspaces if you don't visit for a while. Export a backup or sign in to sync." Show it again at most once a week.

## Multi-tab editing

The practice route requests a Web Lock named `workspace:<id>` with `ifAvailable: true`.

- Lock granted: the tab edits normally and holds the lock until it leaves the route.
- Lock not granted: the tab opens read-only with the banner "This workspace is open in another tab." and a **Take over** button.
- **Take over** posts `{ type: 'release', id }` on a `BroadcastChannel('minji')`. The holder flushes autosave, releases the lock, and switches to read-only. The requesting tab then waits for the lock without `ifAvailable`.
- Every committed write posts `{ type: 'changed', id }` on the same channel so read-only tabs and the home list reload that workspace.

## Export format

Export and JSON import use one versioned format. Files are named `minji-<slug-or-all>-<yyyy-mm-dd>.json`.

```json
{
  "format": "minji.workspaces",
  "version": 1,
  "exportedAt": "2026-10-27T10:00:00.000Z",
  "workspaces": [
    {
      "title": "Two Sum",
      "statement": "Given an array…",
      "notes": "",
      "language": "typescript",
      "functionName": "twoSum",
      "params": ["nums", "target"],
      "source": "function twoSum(nums: number[], target: number): number[] { … }",
      "starterSource": "function twoSum(nums: number[], target: number): number[] {\n\n}",
      "testTimeoutMs": 2000,
      "tests": [
        { "label": "basic", "args": [[2, 7, 11, 15], 9], "expected": [0, 1] },
        { "label": "", "args": "[[3,2,4], 6", "expected": "[1,2]", "compare": { "kind": "return" } }
      ],
      "revisions": [{ "language": "typescript", "source": "…", "reason": "run", "createdAt": "…" }]
    }
  ]
}
```

- `args` and `expected` are written as JSON values when the raw text is valid, and as the raw string otherwise, so nothing is lost. On import, a string is taken as raw text and any other value is written as compact JSON (`[[2,7,11,15],9]`). A value that is itself a JSON string is exported as its raw text (`"\"abc\""`) so it survives the round trip.
- `compare` is optional on import and defaults to `{ "kind": "return" }`.
- Only `title` and `source` are required on import. Other fields default as for a scratch workspace (see workspaces-and-import.md). `revisions` is optional.
- Import always creates new ids and new workspaces with `syncState: 'local'`; it never overwrites an existing workspace.
- Ids, sync fields, runs and `lastRun` are not exported.
- Unknown `version` values are rejected with "This file was made by a newer version of the app." Unknown fields are ignored.
