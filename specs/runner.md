# Runner

The runner strips TypeScript, executes user code in isolation, and reports one result per test. The page owns expected values and comparison; the runner never sees them.

Step 0 compared QuickJS WebAssembly with native Workers and chose **native Workers in a sandboxed iframe**. The measurements and reasons are in [runner-decision.md](runner-decision.md).

## Interface

```ts
interface RunnerTest {
  id: string;
  argsJson: string; // JSON array text, validated by the page; parsed inside the sandbox
  capture: CompareTarget; // what to send back: the return value or args[index] after the call
  kind?: "function" | "class";
  inputAdapters?: ("plain" | "linked-list" | "binary-tree")[];
  outputAdapter?: "plain" | "linked-list" | "binary-tree";
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
  run(request: RunRequest, onEvent: (event: RunnerEvent) => void): Promise<void>; // resolves once the run has ended
  stop(): void; // user pressed Stop: kill the current run, report remaining tests as stopped
  dispose(): void; // tear down; a new Runner is created on next use
}
```

`src/runner/createRunner.ts` returns the native runner. The page creates the runner lazily on the first run and keeps it between runs. One run at a time: `run` rejects while another run is in progress.

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

Every run ends with exactly one `run-complete` or `crashed`. Before it come either one `compile-error` or `imports-unsupported` (and no test results), or one `test-result` per test in request order. After `crashed`, the page reports any test without a result as `crashed`.

`RunSession` (`src/runner/session.ts`) enforces this on the page side: it drops duplicates and late events, applies the per-run console cap, and runs the watchdog.

## Pipeline per run

1. **Check limits.** The page rejects the run before calling the runner when `source`, a test's args, or the total input exceed the limits in specs/README.md.
2. **Strip types** on the page. Run `sucrase.transform(source, { transforms })` with `transforms = ['typescript', 'imports']` for TypeScript and `['imports']` for JavaScript, `disableESTransforms: true`, `production: true`. A sucrase syntax error becomes `compile-error` with its line and column. Sucrase keeps line numbers and reports only the first error; the editor shows the rest.
3. **Build the loader body** (`buildLoaderBody`): the transformed code followed by a return object containing the named callable and any `ListNode` or `TreeNode` constructors declared by the solution. `NAME` is the `functionName`, validated as an identifier because it is interpolated. The `imports` transform turns `export` into assignments on `exports` and `import` into `require(...)`, and adds `"use strict"`.
4. **Per test**, in a fresh Worker:
   1. Evaluate the harness (`src/runner/guest.js`), which installs the console shim and `__minjiRun`.
   2. Compile the loader body with `new Function("exports", "module", "require", body)`. A `SyntaxError` here becomes `compile-error` (without a line number) and ends the run.
   3. `__minjiRun` calls the loader with a fresh `exports`/`module` and a `require` that throws; a thrown import becomes `imports-unsupported` and ends the run. Any other throw while loading becomes `threw` for that test.
   4. No function found → `missing-function`.
   5. Parse the args from JSON inside the Worker. For function cases, convert selected array arguments to list or tree nodes. For class cases, construct the class and call each named method in order on the same instance.
   6. Time the call with `performance.now()`.
   7. Encode either the return value or `args[capture.index]`, and post the result as a JSON string.

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

Encoding runs inside the Worker, walks depth-first tracking ancestors (a shared, non-circular reference is fine), gives up past 1 000 levels of nesting, and stops with `output-too-large` once the estimated JSON size passes `MAX_RESULT_BYTES`. `__proto__` keys stay data. The page decodes nothing; it compares `Encoded` values directly (see test-cases.md). Expected values use the same tags.

The harness captures `JSON`, `Array.isArray`, `Object.keys` and friends before user code runs, so user code that replaces them doesn't break result reporting.

## Console shim

`console.log`, `info`, `warn`, `error`, `debug` append entries. Arguments are formatted like this and joined with a space:

- strings as-is;
- everything else as compact JS-like text: `{a: undefined}`, `[1, NaN]`, `-0`, `[Map]`, `[Function twoSum]`, `[Circular]`, with at most 4 levels and 100 items per level.

Output beyond `MAX_CONSOLE_BYTES_PER_TEST` is dropped inside the Worker; output beyond `MAX_CONSOLE_BYTES_PER_RUN` across tests is dropped by `RunSession`. Either sets `consoleTruncated`. Logging never fails a test. Output from a test that times out is lost with its Worker.

## Timeouts and the watchdog

- Each test has `testTimeoutMs`, counted from when its Worker has started and received the test, so Worker startup is excluded. Exceeding it terminates the Worker and gives `timeout`; the run continues with the next test.
- The whole run has a budget of `min(MAX_RUN_TIMEOUT_MS, tests × testTimeoutMs + RUN_OVERHEAD_MS) + WATCHDOG_GRACE_MS`, counted from when the iframe reports `started`, so loading the iframe is excluded.
- When the budget runs out, the watchdog removes the iframe (ending its Workers) and emits `crashed` with `reason: 'watchdog'`. The next run creates a new iframe.
- **Stop** removes the iframe the same way but reports remaining tests as `stopped` and ends with `run-complete` (`stopped: true`).
- If the iframe doesn't report `ready` within 10 s, the run ends with `crashed` (`worker-error`).

## Sandbox

- The page embeds `<iframe sandbox="allow-scripts" src="/runner.html" hidden>`. Without `allow-same-origin` the iframe has an opaque origin, so it has no access to the app's IndexedDB, localStorage or cookies.
- `public/runner.html` carries its CSP in a `<meta>` tag: `default-src 'none'; script-src 'unsafe-eval' 'sha256-…'; worker-src blob:; connect-src 'none'`. The hash pins the inline bootstrap script; `src/runner/native/runner-csp.test.ts` fails if they drift, and `vpx ./scripts/update-runner-csp.ts` rewrites it. `'unsafe-eval'` allows the `new Function` compile step. `public/runner.html` is excluded from formatting so its bytes stay stable.
- Blob Workers inherit the iframe's CSP, so `connect-src 'none'` and `script-src` apply to user code.
- The page talks to the iframe with `postMessage`, accepting only messages whose `event.source` is the iframe's `contentWindow`. The iframe accepts only messages from `parent` with the expected shape, and only one run at a time.
- The Worker script (harness plus driver) is the same for every run; the loader body, args and config arrive by message. Each test gets a new Worker from the same `blob:` URL, so each test has fresh globals.
- Stack overflow is recognised by message (`Maximum call stack size exceeded` in V8 and JavaScriptCore, `too much recursion` in SpiderMonkey). Workers have small stacks: roughly 5 000 frames of a minimal function in Chromium and Firefox and 3 000 in Safari.
- There is no memory limit beyond the browser's own. A Worker that dies without a result is reported as `memory-limit` when its error mentions memory, else `threw`.

## Fixtures

`src/runner/fixtures/` holds user-code samples (excluded from type checking, linting and formatting). `src/runner/runner.browser.test.ts` runs them in Chromium, Firefox and WebKit; `src/runner/guest.test.ts` runs the harness in a Node `vm` context.

| Fixture                           | Checks                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| `two-sum.ts`, `two-sum.js`        | TS and JS basics, `var f = function` and `function f` forms; cold/warm     |
| `export-default.ts`               | anonymous `export default function` lookup                                 |
| `import-lodash.ts`                | `imports-unsupported` ends the run                                         |
| `compile-error.ts`                | sucrase syntax error with line                                             |
| `engine-syntax-error.js`          | engine-only syntax error (duplicate parameter in strict mode)              |
| `merge-sort.ts`                   | 10⁵ and 10⁶ random integers                                                |
| `dp-grid.ts`                      | nested-loop speed (10⁶ cells)                                              |
| `deep-recursion.js`               | depth 2 000 succeeds; 10⁶ gives `stack-overflow`                           |
| `infinite-loop.js`                | `timeout` within deadline; page thread stays responsive; Stop; watchdog    |
| `in-place.js`                     | `moveZeroes` with `capture: argument 0`                                    |
| `returns-special.js`              | `undefined`, `NaN`, `-0`, holes, `Map`, cycles, BigInt, class, `__proto__` |
| `console-flood.js`                | truncation                                                                 |
| `global-leak.js`                  | a global set in test 1 is absent in test 2                                 |
| `throws.js`, `top-level-throw.js` | thrown errors at call and load time                                        |
| `isolation.js`                    | IndexedDB, sync XHR, `importScripts`, `document`, `localStorage` blocked   |

`src/runner/bench/` is a throwaway page for measuring on a real phone (`vp dev --host`, then `/src/runner/bench/`).
