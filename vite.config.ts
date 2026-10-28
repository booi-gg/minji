import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

// User-code and pasted-problem samples. They are data, not project code.
const runnerFixtures = "src/runner/fixtures/**";
const importFixtures = "src/import/fixtures/**";

// The Cloudflare plugin runs the Worker in workerd; tests don't need it.
const isTest = process.env.VITEST !== undefined;

export default defineConfig({
  plugins: isTest ? [react()] : [react(), cloudflare()],
  server: { port: 8000, strictPort: true },
  fmt: {
    // runner.html's CSP pins the exact bytes of its inline script.
    ignorePatterns: [runnerFixtures, importFixtures, "public/runner.html"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    ignorePatterns: [runnerFixtures, importFixtures],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
        },
      },
    ],
  },
});
