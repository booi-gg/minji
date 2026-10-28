# minji

Personal workspace for practising data structures and algorithms problems in JavaScript and TypeScript. See [PLAN.md](PLAN.md), the [specs](specs/README.md) and the [checklist](TODO.md).

## Development

```bash
vp install
vp dev
```

`vp dev` serves the app at `http://localhost:8000` and runs the Cloudflare Worker together with it: `@cloudflare/vite-plugin` serves `/api/*` from a local workerd runtime, so no separate `wrangler dev` is needed.

| Command                                               | What it does                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `vp check`                                            | Format check, lint and type check                                       |
| `vp check --fix`                                      | Format and apply lint fixes                                             |
| `vp test`                                             | Unit tests (Node) and runner tests (Chromium, Firefox, WebKit)          |
| `vp test --project unit`                              | Unit tests only                                                         |
| `vp run build`                                        | Type-check, build, and generate the offline service worker              |
| `vp run deploy:staging`                               | Build and deploy to the `minji-staging` Worker (needs `wrangler login`) |
| `vpx ./scripts/e2e-accounts.ts http://localhost:8000` | Account, sync and conflict UI check against a shared test API           |
| `vpx ./scripts/e2e-offline.ts http://localhost:4173`  | Offline check against `vp preview` after a production build             |

Runner tests need Playwright's browsers once: `node_modules/.bin/playwright install chromium firefox webkit`.

After editing the inline script in `public/runner.html`, update its CSP hash with `vpx ./scripts/update-runner-csp.ts`.

## Test cases

Open a workspace, set the **Function name** in the toolbar to the function or class in your code, and open the **Tests** tab. Select **Add test**, optionally name the case, then fill in **Arguments** and **Expected**. Both fields use JSON: strings need double quotes, and the Arguments field is always an array with one entry per function parameter. Use `[]` for a function with no arguments. Select **Run** on a row to run one case or **Run all** to run every valid case; invalid cases show an error and are skipped.

### Function calls and returned values

Leave **Test type** on **Function call** and **Compare** on **Return value**. For `twoSum(nums, target)`, use:

| Field     | Value             |
| --------- | ----------------- |
| Arguments | `[[2,7,11,15],9]` |
| Expected  | `[0,1]`           |

The outer Arguments array contains two values: the `nums` array and the `target` number. For `answer()` returning `42`, enter Arguments `[]` and Expected `42`. Expected can also be a JSON string, boolean, `null`, array, or object. Object key order does not matter; array order does by default.

### Functions that change an argument

For a function such as `reverse(nums)` that changes the input array and returns nothing, enter Arguments `[[1,2,3]]`, Expected `[3,2,1]`, and set **Compare** to **Argument 1 (nums) after the call**. Choose the argument the solution changes; **Return value** would compare its `undefined` return instead.

### Linked lists and binary trees

Node adapters are available on **Function call** cases. Enter ordinary JSON arrays, then choose an adapter for each argument that the solution expects as nodes. Choose a **Result adapter** when the returned value or compared argument is also a node. The runner supplies `ListNode` and `TreeNode` constructors to solution code.

| Function shape                         | Arguments   | Expected         | Adapter settings                                     |
| -------------------------------------- | ----------- | ---------------- | ---------------------------------------------------- |
| `append(head)` returns a linked list   | `[[1,2,3]]` | `[1,2,3,4]`      | Argument 1: **Linked list**; Result: **Linked list** |
| `addRight(root)` returns a binary tree | `[[1,2,3]]` | `[1,2,3,null,7]` | Argument 1: **Binary tree**; Result: **Binary tree** |

Lists use values from head to tail. Trees use level order with `null` for missing children, so `[1,null,3]` means the root has no left child and a right child with value `3`. Use `[]` for an empty list or tree. For an in-place node change, select the changed argument under **Compare** and still set its **Result adapter** so the result is converted back to an array.

### Class method sequences

Set the toolbar **Function name** to the class name and choose **Class method sequence** as the test type. For `class Counter` with `constructor(start)`, `add(amount)`, and `get()`, enter:

| Field     | Value                                                       |
| --------- | ----------------------------------------------------------- |
| Arguments | `[["Counter","add","get","add","get"],[[2],[3],[],[4],[]]]` |
| Expected  | `[null,null,5,null,9]`                                      |

The first array lists the constructor and method names. The second array gives each call's arguments in the same order. The constructor's result is always `null`; methods that return `undefined` also appear as `null`. Each test case creates a fresh instance. Class cases compare the whole result sequence and do not use node adapters.

### Comparison options for each case

- **Ignore outer array order** accepts a permutation of the Expected array, including duplicate values. Nested arrays still compare in order. For example, Expected `[1,1,2]` accepts `[2,1,1]` but not `[2,2,1]`.
- **Numeric tolerance (absolute)** accepts numeric differences up to the entered amount, including numbers inside arrays and objects. For example, Expected `3.14` accepts `3.141` with tolerance `0.01`. Leave it blank for exact comparison.
- Both options can be used together. They apply only to the case where you set them.

Expected values that JSON cannot express directly can use `{"$minji":"undefined"}`, `{"$minji":"NaN"}`, `{"$minji":"Infinity"}`, `{"$minji":"-Infinity"}`, or `{"$minji":"-0"}`. For example, use `{"$minji":"undefined"}` when a function intentionally returns `undefined`. Arguments remain ordinary JSON. See [test case rules](specs/test-cases.md) for validation, comparison, and result details.

## Offline work and organization

Production builds register a service worker that caches the app and editor for offline use. Workspaces and edits remain in IndexedDB, and account changes sync when the connection returns. The footer shows connection status, pending workspaces, conflicts that need attention, and the last completed sync. On the home screen, use **Organize** to assign a folder and tags, then filter the list by either. Folder and tag values are included in JSON export and account sync. GitHub is the only sign-in provider.

## Account setup and deployment

The D1 databases `minji` and `minji-staging` already exist, and migration `0001_init.sql` has been applied to both. Each Worker needs its own GitHub OAuth app:

| Environment | Homepage URL                                    | Authorization callback URL                                               |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| Staging     | `https://minji-staging.booboosable.workers.dev` | `https://minji-staging.booboosable.workers.dev/api/auth/github/callback` |
| Production  | `https://minji.booboosable.workers.dev`         | `https://minji.booboosable.workers.dev/api/auth/github/callback`         |

Create the apps in GitHub **Settings → Developer settings → OAuth apps**. Put each client ID in its corresponding `GITHUB_CLIENT_ID` value in `wrangler.jsonc`. Set each client secret through Wrangler so it never enters the repository:

```bash
wrangler secret put GITHUB_CLIENT_SECRET --env staging
wrangler secret put GITHUB_CLIENT_SECRET
```

Then run `vp run deploy:staging`. Check `/api/health`, `/w/anything`, sign-in and a sync round trip on staging before `vp run deploy`. The local Playwright check uses a test API and does not need GitHub credentials.
