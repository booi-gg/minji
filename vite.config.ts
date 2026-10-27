import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

// User-code samples for the runner. They are data, not project code.
const runnerFixtures = "src/runner/fixtures/**";

export default defineConfig({
  fmt: {
    // runner.html's CSP pins the exact bytes of its inline script.
    ignorePatterns: [runnerFixtures, "public/runner.html"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    ignorePatterns: [runnerFixtures],
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
