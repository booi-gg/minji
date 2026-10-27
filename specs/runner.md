# Runner

The runner strips TypeScript, executes user code in isolation, and reports one result per test. The page owns expected values and comparison; the runner never sees them.

Step 0 builds two implementations of the same interface and picks one. Everything in this spec except the "Implementations" section applies to both.

## Interface

```ts
interface RunnerTest {
  id: string;
  args: unknown[]; // parsed from argsText by the page
  capture: CompareTarget; // what to send back: the return value or args[index] after the call
}

interface RunRequest {
  runId: string;
  language: Language;
  source: string;
  functionName: string;
  tests: RunnerTest[];
  testTimeoutMs: number;
}

interface Runner {
  run(request: RunRequest, onEvent: (event: RunnerEvent) => void): Promise<void>; // resolves after run-complete
  stop(): void; // user pressed Stop: kill the current run, report remaining tests as stopped
  dispose(): void; // tear down; a new Runner is created on next use
}
```

`src/runner/createRunner.ts` returns the implementation chosen in step 0. The page creates the runner lazily on the first run and keeps it between runs.

## Events

```ts
type RunnerEvent =
  | { type: "compile-error"; runId: string; message: string; line?: number; column?: number }
  | { type: "imports-unsupported"; runId: string; specifier: string }
  | { type: "test-result"; runId: string; result: RawTestResult }
  | { type: "run-complete"; runId: string; stopped: boolean }
  | { type: "crashed"; runId: string; reason: "watchdog" | "worker-error"; message: string };

interface RawTestResult {
  testId: string;
  kind:
    | "returned"
    | "threw"
    | "timeout"
    | "non-serializable"
    | "missing-function"
    | "memory-limit"
    | "stack-overflow"
    | "output-too-large"
    | "stopped";
  value?: Encoded; // when kind is 'returned'
  error?: { name: string; message: string; stack?: string };
  nonSerializable?: { path: string; type: string }; // e.g. { path: '[2].next', type: 'Map' }
  console: ConsoleEntry[];
  consoleTruncated: boolean;
  durationMs: number; // time inside the function call only
}

interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
}
```

Order: zero or one `compile-error`/`imports-unsupported` (which ends the run, no test results follow), then one `test-result` per test in request order, then `run-complete`. `crashed` can replace everything after it; the page reports any test without a result as `crashed`.

## Pipeline per run

1. **Check limits.** The page rejects the run before calling the runner when `source`, a test's args, or the total input exceed the limits in specs/README.md.
2. **Strip types.** Run `sucrase.transform(source, { transforms })` with `transforms = ['typescript', 'imports']` for TypeScript and `['imports']` for JavaScript, `disableESTransforms: true`, `production: true`. A sucrase syntax error becomes `compile-error` with its line and column. Sucrase reports only the first error; Monaco shows the rest in the editor.
3. **Wrap.** The `imports` transform turns `export` into assignments on `exports` and `import` into `require(...)`. The harness defines `exports`, `module`, and a `require` that throws an `ImportsUnsupported` error carrying the specifier. A thrown `ImportsUnsupported` during evaluation becomes `imports-unsupported`. The transformed code runs in strict mode, which matches how LeetCode runs JavaScript.
4. **Per test**, in a fresh global scope (see Implementations):
   1. Install the console shim and the harness globals.
   2. Evaluate the transformed code as a classic script. A throw here becomes `threw` for this test; it repeats identically for every test, which is acceptable.
   3. Resolve the function: `typeof <name> === 'function' ? <name> : exports[<name>] ?? exports.default`. `<name>` is the validated `functionName`. Not a function → `missing-function`.
   4. Parse the args from JSON inside the runtime, so the function receives values it can mutate.
   5. Start the per-test timer, call the function with the args spread, stop the timer.
   6. Encode either the return value or `args[capture.index]`.

## Value encoding

Results cross the boundary as `Encoded`: plain JSON, with tagged objects for values JSON would change silently.

| Value                                                                              | Encoded as                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `null`, booleans, strings, finite numbers                                          | themselves                                                                          |
| `-0`                                                                               | `{"$minji":"-0"}`                                                                   |
| `NaN`                                                                              | `{"$minji":"NaN"}`                                                                  |
| `Infinity` / `-Infinity`                                                           | `{"$minji":"Infinity"}` / `{"$minji":"-Infinity"}`                                  |
| `undefined` (return value, array element, or hole)                                 | `{"$minji":"undefined"}`                                                            |
| Array                                                                              | array of encoded elements                                                           |
| Plain object (prototype `Object.prototype` or `null`)                              | object of encoded values; properties whose value is `undefined` are kept and tagged |
| Plain object with an own `$minji` key                                              | `{"$minji":"object","value":{…}}`                                                   |
| Function, symbol, BigInt, `Map`, `Set`, `Date`, class instance, typed array, cycle | `non-serializable` with the path and type of the first offender                     |

Encoding runs inside the runtime, walks depth-first with a visited set, and stops with `output-too-large` once the encoded JSON passes `MAX_RESULT_BYTES`. The page decodes nothing; it compares `Encoded` values directly (see test-cases.md). Expected values use the same tags.

## Console shim

`console.log`, `info`, `warn`, `error`, `debug` append entries. Arguments are formatted like this and joined with a space:

- strings as-is;
- everything else with the encoder, rendered as compact JSON with tags shown as `undefined`, `NaN`, `-0`, `Infinity`, and non-serializable values shown as `[Map]`, `[Function twoSum]`, `[Circular]` instead of failing.

Output beyond `MAX_CONSOLE_BYTES_PER_TEST`, or beyond `MAX_CONSOLE_BYTES_PER_RUN` in total, is dropped and `consoleTruncated` is set. Logging never fails a test.

## Timeouts and the watchdog

- Each test has `testTimeoutMs`. Exceeding it gives `timeout` for that test; the run continues with the next test.
- The whole run is capped at `min(MAX_RUN_TIMEOUT_MS, tests × testTimeoutMs + 5 000)`.
- The page-side watchdog fires at that cap plus `WATCHDOG_GRACE_MS`. It disposes the runner, emits `crashed` with `reason: 'watchdog'`, and the next run creates a new runner. This also covers work the runtime cannot interrupt, such as a native `Array.prototype.sort` on a huge array.
- **Stop** behaves like the watchdog but reports remaining tests as `stopped` instead of `crashed`.

## Implementations

### A. QuickJS in a dedicated Worker

- `src/runner/quickjs/worker.ts` runs in a module Worker created with Vite's `?worker` import. It loads `quickjs-emscripten` (sync variant) and `sucrase` on first use.
- One `QuickJSRuntime` per run with `setMemoryLimit(RUNTIME_MEMORY_LIMIT_BYTES)` and `setMaxStackSize(RUNTIME_STACK_LIMIT_BYTES)`. One new `QuickJSContext` per test, disposed after the test.
- Per-test deadline through `runtime.setInterruptHandler(shouldInterruptAfterDeadline(start + testTimeoutMs))`. An interrupt becomes `timeout`; an out-of-memory error becomes `memory-limit`; QuickJS's stack overflow `InternalError` becomes `stack-overflow`.
- Timing uses `performance.now()` around the call in the worker; it includes interpreter overhead.
- Every QuickJS handle is disposed; a leaked handle fails the unit tests (`runtime.dumpMemoryUsage` / debug build in tests).

### B. Native Worker in a sandboxed iframe

- The page embeds `<iframe sandbox="allow-scripts" src="/runner.html" hidden>`. Without `allow-same-origin` the iframe has an opaque origin, so it has no access to the app's IndexedDB, localStorage or cookies.
- `runner.html` is served with the response header `Content-Security-Policy: default-src 'none'; script-src 'self' blob:; worker-src blob:; connect-src 'none'` through the Static Assets `_headers` file. Step 0 verifies how `'self'` behaves in the opaque-origin document in Chrome, Firefox and Safari; if it doesn't match, inline the bootstrap script and allow it by hash.
- The page talks to the iframe with `postMessage`, accepting only messages whose `event.source` is the iframe's `contentWindow`. The iframe validates the message shape before acting.
- The iframe creates **one new Worker per test** from a `blob:` URL holding the harness and the transformed code, so each test gets fresh globals. Sucrase runs once per run in the iframe's own thread.
- Per-test deadline: the iframe terminates that test's Worker after `testTimeoutMs` and reports `timeout`. A `RangeError: Maximum call stack size exceeded` becomes `stack-overflow`. There is no memory limit beyond the browser's own; a crashed Worker (`error` event without a result) becomes `memory-limit` when its message mentions memory and `threw` otherwise.
- Watchdog and **Stop** remove the iframe from the DOM, which ends its Workers, and create a fresh iframe for the next run.

## Step 0 benchmark set

Store these in `src/runner/fixtures/` and run them against both implementations in Vitest browser mode (`vite-plus/test/browser-playwright`):

| Fixture                                  | Checks                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| `two-sum.ts`, `two-sum.js`               | TS and JS basics, `var f = function` and `function f` forms |
| `export-default.ts`                      | `export default function` lookup                            |
| `import-lodash.ts`                       | `imports-unsupported`                                       |
| `merge-sort-1e5.ts`, `merge-sort-1e6.ts` | large input speed                                           |
| `dp-grid-1000.ts`                        | nested-loop speed (10⁶ cells)                               |
| `deep-recursion.js`                      | recursion depth 10 000 succeeds; 10⁶ gives `stack-overflow` |
| `infinite-loop.js`                       | `timeout` within deadline + 100 ms; editor stays responsive |
| `native-sort-huge.js`                    | watchdog path                                               |
| `in-place.js`                            | `moveZeroes`, `capture: argument 0`                         |
| `returns-special.js`                     | `undefined`, `NaN`, `-0`, `Map` encoding                    |
| `console-flood.js`                       | truncation                                                  |
| `global-leak.js`                         | a global set in test 1 is absent in test 2                  |

Record for each implementation, on desktop Chrome, Firefox, Safari and a mid-range Android phone: first-run time including downloads (cold cache), warm run time, peak memory (`performance.measureUserAgentSpecificMemory` where available, else Task Manager), and pass/fail per fixture. Write the results and the decision to `specs/runner-decision.md`.

**Decision rule:** choose QuickJS only if every fixture passes and `merge-sort-1e6` finishes under `DEFAULT_TEST_TIMEOUT_MS` on the phone. Otherwise choose the native runner, provided its CSP and isolation checks pass in all three desktop browsers.
