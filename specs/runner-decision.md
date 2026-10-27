# Runner decision (step 0)

**Decision: the native runner** (candidate B: a fresh Web Worker per test inside an opaque-origin sandboxed iframe with a strict CSP). QuickJS (candidate A) was removed.

Measured 2026-10-27 with `vp test --project browser` (Vitest browser mode, headless Playwright: Chromium, Firefox, WebKit) on the development Mac. The mid-range phone has not been measured yet; see "Still open".

## Results

Times in ms. "Call" is time inside the user's function; "run" is the whole run as the page sees it.

| Measure                                     | Native · Chromium | Native · Firefox | Native · WebKit | QuickJS · Chromium | QuickJS · Firefox | QuickJS · WebKit |
| ------------------------------------------- | ----------------: | ---------------: | --------------: | -----------------: | ----------------: | ---------------: |
| First run (two-sum)                         |                14 |               25 |              13 |                 84 |                76 |               87 |
| Warm run (two-sum)                          |                 5 |                9 |               3 |                  4 |                11 |                5 |
| Merge sort 10⁵, call                        |                16 |               20 |              15 |                232 |               258 |              185 |
| Merge sort 10⁶, call                        |               127 |              184 |             110 |           **2456** |          **2571** |             1762 |
| Merge sort 10⁶, run                         |               215 |              248 |             156 |               2874 |              3114 |             2112 |
| DP grid 1000 × 1000, call                   |                 7 |                5 |               5 |                 35 |                40 |               24 |
| Infinite loop, 500 ms timeout, run          |               512 |              505 |             502 |                529 |               558 |              548 |
| Largest page-thread gap during the hung run |                11 |               13 |              13 |                 11 |                16 |               14 |

QuickJS is 10–20× slower on the DSA workloads and misses the 2 s default timeout for an O(n log n) sort of 10⁶ elements on desktop, before any phone slowdown.

### Recursion depth

`depth(n) = n === 0 ? 0 : 1 + depth(n - 1)`:

| Runner · browser   | Deepest clean result                     | First failure                                                              |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| Native · Chromium  | 5 000                                    | 7 000 → `stack-overflow`                                                   |
| Native · Firefox   | 5 000                                    | 7 000 → `stack-overflow`                                                   |
| Native · WebKit    | 3 000                                    | 5 000 → `stack-overflow`                                                   |
| QuickJS · Chromium | 500 (with a 128 KiB QuickJS stack limit) | 1 000 → runtime abort (`JS_FreeRuntime` assertion) for any limit ≥ 256 KiB |
| QuickJS · Firefox  | 2 000 (512 KiB limit)                    | 3 000 → runtime abort                                                      |
| QuickJS · WebKit   | none                                     | 500 → runtime abort at every limit tried (64 KiB–1 MiB)                    |

QuickJS's interpreter recurses on the engine's native stack, which Workers keep small, so deep JavaScript recursion overflows the native stack before QuickJS's own check fires and corrupts the runtime. That alone rules it out.

### Isolation (native)

From user code inside the sandbox Worker, in all three browsers: `indexedDB.open` throws, synchronous `XMLHttpRequest` to the app origin throws, `importScripts` from the app origin throws, and `document` and `localStorage` don't exist. The CSP hash test keeps `runner.html`'s inline script pinned.

### Everything else

Both candidates passed the other fixtures: TS and JS lookup forms, default export, imports rejected, sucrase and engine syntax errors, in-place capture, special-value encoding, console truncation, fresh globals per test, thrown errors, missing function, Stop, and watchdog recovery.

## Consequences

- **Recursion limit.** Browsers give Workers a small stack: about 5 000 frames of a minimal function in Chromium and Firefox, about 3 000 in Safari, and fewer for functions with more locals. There is no API to enlarge it. The fixture now checks depth 2 000 and the `stack-overflow` message should say so (test-cases.md).
- **`'unsafe-eval'` in the runner CSP.** The Worker compiles user code with `new Function`, because Firefox and Safari don't expose the message of a Worker script's parse error. This only applies inside the sandbox, which exists to run untrusted code; `connect-src 'none'` still blocks the network.
- **Syntax errors found by the engine have no line number.** Sucrase finds most syntax errors first and reports the line.
- **No memory limit beyond the browser's own.** A runaway allocation crashes the test Worker, which is reported per test.

## Still open

- **Mid-range phone.** Run `vp dev --host`, open `/src/runner/bench/` on the phone, press **Run benchmarks**, and add the numbers here. The gate needs merge sort 10⁶ under 2 s.
- **Async network block.** `fetch` exists in the Worker. CSP `connect-src 'none'` should reject it, but the harness has no async support yet, so this is not tested.
- **Memory use.** Not measured; `performance.measureUserAgentSpecificMemory` needs cross-origin isolation.
- The Claude desktop app's built-in browser blocks the sandboxed iframe (`ERR_BLOCKED_BY_CLIENT`); runs there report `crashed` after the 10 s frame-load timeout. Real browsers are unaffected.
