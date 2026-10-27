# Test cases and results

## Authoring

The **Tests** tab lists a workspace's cases in `position` order. Each row has:

| Control   | Behaviour                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label     | Optional text field. Placeholder `Test <n>`.                                                                                                                         |
| Arguments | Monospace auto-growing textarea (up to 8 visible lines), holding `argsText`. A hint above it shows the parameter names, e.g. `[nums, target]`, when `params` is set. |
| Expected  | Monospace textarea holding `expectedText`.                                                                                                                           |
| Compare   | Select: **Return value** (default) or **Argument N after the call** (one entry per argument, labelled with the parameter name when known).                           |
| Run       | Runs only this case.                                                                                                                                                 |
| Actions   | ↑ and ↓ (move), Duplicate and Delete, shown inline on the row.                                                                                                       |

- **Add test** appends a row with `argsText: '[]'`, `expectedText: ''`, and focuses Arguments. It is disabled at `MAX_TESTS_PER_WORKSPACE`.
- Reorder by dragging the row handle, with the menu, or with `Alt+↑` / `Alt+↓` while focus is in the row. Positions are rewritten densely in one transaction.
- **Delete** removes the row at once and shows an **Undo** toast for 5 seconds.
- Arguments or expected text over 100 KB collapses to a summary ("Large input · 2.3 MB") with an **Edit** button, so huge inputs don't slow the page. Editing opens the text in a dialog.
- Edits autosave on the same debounce as code.

## Validation

Validation runs 300 ms after typing stops. Messages appear under the field, except that an empty field is only flagged after it has been left once; the row gets an "Invalid" badge. A new test focuses Arguments with its `[]` selected, so typing replaces it.

| Check                                       | Message                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| Arguments text is not JSON                  | `Arguments aren't valid JSON: <parser message>`                                  |
| Arguments parse but are not an array        | `Arguments must be a JSON array, one entry per parameter, e.g. [[2,7,11,15], 9]` |
| Expected text is empty or not JSON          | `Expected value isn't valid JSON: <parser message>`                              |
| Expected contains an unknown `$minji` tag   | `Unknown special value "<tag>". Use undefined, NaN, Infinity, -Infinity or -0.`  |
| Compare argument index ≥ arguments length   | `There is no argument <n> to compare.`                                           |
| Arguments over `MAX_TEST_INPUT_BYTES`       | `This input is larger than the 8 MB limit.`                                      |
| Argument count differs from `params` length | Warning only: `Expected 2 arguments (nums, target), found 3.`                    |

Invalid tests are skipped when running and reported with status `invalid-test`. Warnings don't block a run.

## Comparison

`compare(expected: Encoded, actual: Encoded): { equal: true } | { equal: false; path: string }` lives in `src/tests/compare.ts` and is pure.

- Tags compare by tag. `{"$minji":"-0"}` equals `0`. `{"$minji":"NaN"}` equals only `NaN`.
- `{"$minji":"object","value":…}` is unwrapped before comparing.
- Numbers compare with `===` after the rules above. No tolerance in the MVP.
- Arrays are equal when lengths match and elements are equal in order.
- Objects are equal when they have the same set of keys, in any order, with equal values.
- Different JSON types are never equal (`1` vs `"1"`, `[]` vs `{}`, `null` vs `undefined`).
- `path` names the first difference: `''` for the root, then `[3]`, `.name`, or `["key with spaces"]` segments, e.g. `[2].next`. A length mismatch reports the array's own path and the UI says "length 4, expected 5".

`CompareTarget` is a discriminated union so per-case options (unordered arrays, numeric tolerance) can be added later without a migration.

## Statuses

```ts
type TestStatus =
  | "passed"
  | "failed"
  | "error"
  | "timeout"
  | "non-serializable"
  | "missing-function"
  | "stack-overflow"
  | "memory-limit"
  | "output-too-large"
  | "invalid-test"
  | "stopped"
  | "crashed";

type RunOutcome =
  | "completed"
  | "compile-error"
  | "imports-unsupported"
  | "rejected"
  | "stopped"
  | "crashed";

interface TestResult {
  testId: string;
  label: string; // snapshot at run time
  status: TestStatus;
  expected?: Encoded;
  actual?: Encoded;
  diffPath?: string;
  error?: { name: string; message: string; stack?: string };
  console: ConsoleEntry[];
  consoleTruncated: boolean;
  durationMs: number | null;
}
```

The page maps each `RawTestResult` from the runner: `returned` becomes `passed` or `failed` by comparison, `threw` becomes `error`, and the other kinds keep their name.

| Status             | Row badge      | Detail text                                                                                                                                      |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `passed`           | Passed         | —                                                                                                                                                |
| `failed`           | Failed         | `Expected` / `Actual` blocks, pretty-printed, with the differing path highlighted: `First difference at [2]`.                                    |
| `error`            | Error          | `<name>: <message>` and the stack with harness frames removed and line numbers mapped to the user's source when possible.                        |
| `timeout`          | Timed out      | `Stopped after 2 s. Look for an infinite loop or a slower-than-expected algorithm.`                                                              |
| `non-serializable` | Can't compare  | `The function returned a <type> at <path>, which can't be compared as JSON. Return arrays, plain objects, strings, numbers, booleans or null.`   |
| `missing-function` | No function    | `No function named "<name>" was found. Check the function name in the toolbar.`                                                                  |
| `stack-overflow`   | Stack overflow | `Maximum call stack size exceeded. Browsers allow only a few thousand nested calls here, so check the base case or switch to an explicit stack.` |
| `memory-limit`     | Out of memory  | `The test ran out of memory.`                                                                                                                    |
| `output-too-large` | Too large      | `The return value is larger than the 8 MB limit.`                                                                                                |
| `invalid-test`     | Invalid test   | The validation message.                                                                                                                          |
| `stopped`          | Stopped        | `The run was stopped.`                                                                                                                           |
| `crashed`          | Runner crashed | `The runner stopped responding and was restarted.`                                                                                               |

Run-level outcomes replace the per-test list with one message:

| Outcome               | Message                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `compile-error`       | `Didn't run: syntax error on line <l>, column <c>: <message>` with a link that moves the cursor there |
| `imports-unsupported` | `Didn't run: imports aren't supported ("<specifier>"). Paste helper code into the solution instead.`  |
| `rejected`            | The limit that was exceeded, e.g. `Your code is larger than the 100 KB limit.`                        |

## Run summary

Shown at the top of the **Results** tab and announced through an `aria-live="polite"` region.

| Situation                  | Text                                                           |
| -------------------------- | -------------------------------------------------------------- |
| Run all, everything passed | `Passed all 8 tests` (`Passed 1 test` for one)                 |
| Run all, some failed       | `Passed 5 of 8 tests`                                          |
| Invalid tests present      | append ` · 1 invalid test skipped`                             |
| Run one                    | `Test "<label or Test n>" passed` / `… failed` / `… timed out` |
| Run-level outcome          | the outcome message                                            |

Never use "Accepted" or any wording that implies a hidden judge. Durations show as `12 ms` beside each row, with the tooltip "Local timing on this device, for comparison between your own runs only."

**Run all** updates `workspace.lastRun` with `passed` and `total`, where `total` counts invalid tests. **Run one** never changes `lastRun`. Every run is stored as a `RunRecord`.

## Console tab

Shows the console entries of the selected test, or of all tests grouped by test with a header row. `warn` and `error` entries use the warning and error colours. When truncated, the last line reads `Output truncated at 16 KB.`
