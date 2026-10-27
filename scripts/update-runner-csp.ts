// Rewrites the CSP script hash in public/runner.html after its inline script changes.
// Usage: vpx ./scripts/update-runner-csp.ts
import { readFileSync, writeFileSync } from "node:fs";
import { withUpdatedHash } from "../src/runner/native/runner-csp.ts";

const path = new URL("../public/runner.html", import.meta.url);
const html = readFileSync(path, "utf8");
const updated = withUpdatedHash(html);
if (updated === html) {
  process.stdout.write("runner.html CSP hash already up to date\n");
} else {
  writeFileSync(path, updated);
  process.stdout.write("Updated runner.html CSP hash\n");
}
