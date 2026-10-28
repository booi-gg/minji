# Test cases and results

## Authoring

The **Testcase** tab has a **Case 1 / Case 2 / … / +** picker in `position` order and shows one selected case. Hovering a case shows **×** to delete it (not on the last case). Function tests show one JSON field per argument, labeled `name =` with the parameter name when known, followed by **Expected =**, all in one column. The fields edit the existing `argsText` JSON array; no data migration is needed. Cases with unsplittable argument text and class method sequences show a raw JSON field.

Cases run with **Run all** (or Mod+Shift+Enter for the selected case). **Options** contains its name, move/duplicate controls, test type, compare target, input and result adapters, unordered comparison, and numeric tolerance. The summary marks customized options. A class case uses `[["ClassName","method"],[[],[args]]]` and compares the full result sequence.

- **Add case** appends a case with `argsText: '[]'` and `expectedText: ''`, selects it, and focuses its first argument when present. It is disabled at `MAX_TESTS_PER_WORKSPACE`.
- **Delete** selects a neighboring case and shows an **Undo** toast for 5 seconds. Moving rewrites positions densely in one transaction.
- Arguments or expected text over 100 KB collapses to a summary ("Large input · 2.3 MB") with an **Edit** button.
- Edits autosave on the same debounce as code.

## Validation

Validation runs 300 ms after typing stops. Messages appear under the field, except that an empty field is only flagged after it has been left once; the case gets an "Invalid" badge.

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
- Numbers compare exactly by default. A case may allow an absolute numeric difference at every nested numeric value.
- Arrays are equal when lengths match and elements are equal in order by default. Unordered comparison matches outer-array elements one to one, including duplicates; nested arrays keep their order.
- Objects are equal when they have the same set of keys, in any order, with equal values.
- Different JSON types are never equal (`1` vs `"1"`, `[]` vs `{}`, `null` vs `undefined`).
- `path` names the first difference: `''` for the root, then `[3]`, `.name`, or `["key with spaces"]` segments, e.g. `[2].next`. A length mismatch reports the array's own path and the UI says "length 4, expected 5".

Class cases construct a fresh instance and call methods in sequence. `undefined` method results become `null`. Node adapters convert JSON arrays to nodes before function calls and convert the selected result back to arrays before encoding.

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
| `passed`           | Passed         | Selected case input, expected output, and actual output.                                                                                         |
| `failed`           | Failed         | Selected case input, expected output, and actual output, with the first differing path.                                                          |
| `error`            | Error          | `<name>: <message>` and the stack with harness frames removed and line numbers mapped to the user's source when possible.                        |
| `timeout`          | Timed out      | `Stopped after 2 s. Look for an infinite loop or a slower-than-expected algorithm.`                                                              |
| `non-serializable` | Can't compare  | `The function returned a <type> at <path>, which can't be compared as JSON. Return arrays, plain objects, strings, numbers, booleans or null.`   |
| `missing-function` | No function    | `No function named "<name>" was found. Check the entry point in More.`                                                                           |
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

The **Test Result** tab shows the run summary as a heading (green when every case passed, red otherwise), then a case picker with a pass/fail dot per case. It shows only the selected case, in one column: Input, Stdout (when the case logged anything), Output and Expected — or the status and its detail for other statuses; selecting another case does not rerun code. Inputs come from the run snapshot, so later test edits do not change the displayed result.

| Situation                  | Text                                                           |
| -------------------------- | -------------------------------------------------------------- |
| Run all, everything passed | `Passed all 8 tests` (`Passed 1 test` for one)                 |
| Run all, some failed       | `Passed 5 of 8 tests`                                          |
| Invalid tests present      | append ` · 1 invalid test skipped`                             |
| Run one                    | `Test "<label or Test n>" passed` / `… failed` / `… timed out` |
| Run-level outcome          | the outcome message                                            |

Never use "Accepted" or any wording that implies a hidden judge. Durations show as `Runtime 12 ms` under the selected case, with the tooltip "Local timing on this device, for comparison between your own runs only."

**Run all** updates `workspace.lastRun` with `passed` and `total`, where `total` counts invalid tests, only when the run completes (not when stopped or crashed); this doesn't change `updatedAt`. **Run one** never changes `lastRun`. Every run that starts is stored as a `RunRecord`; runs rejected before starting (no tests, code over the limit) only show their message.

Error details list the stack frames in the user's code as `at helper (line 16)`, each a link that moves the editor's cursor there. Harness frames are removed. Line numbers come from `src/runner/stack.ts`; Safari reports no locations for this code, so it shows function names only.

## Stdout

The selected case's console entries show under **Stdout** in the Test Result tab. `warn` and `error` entries use the warning and error colours. When truncated, the last line reads `Output truncated at 16 KB.`
