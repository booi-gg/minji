// Every size, count and time limit in one place. See specs/README.md.

const KIB = 1024;

export const MAX_SOURCE_BYTES = 100_000;
export const MAX_TESTS_PER_WORKSPACE = 100;
export const MAX_TEST_INPUT_BYTES = 8_000_000;
export const MAX_RUN_INPUT_BYTES = 32_000_000;
export const MAX_RESULT_BYTES = 8_000_000;
export const MAX_CONSOLE_BYTES_PER_TEST = 16 * KIB;
export const MAX_CONSOLE_BYTES_PER_RUN = 64 * KIB;

export const DEFAULT_TEST_TIMEOUT_MS = 2000;
export const MIN_TEST_TIMEOUT_MS = 500;
export const MAX_TEST_TIMEOUT_MS = 10_000;
export const MAX_RUN_TIMEOUT_MS = 30_000;
/** Slack added to the per-run budget for evaluation and messaging between tests. */
export const RUN_OVERHEAD_MS = 5000;
export const WATCHDOG_GRACE_MS = 1000;

export const REVISIONS_PER_WORKSPACE = 20;
export const RUNS_PER_WORKSPACE = 10;

export const AUTOSAVE_DEBOUNCE_MS = 500;
export const SYNC_DEBOUNCE_MS = 3000;
export const SYNC_PULL_INTERVAL_MS = 60_000;
export const MAX_SYNC_DOC_BYTES = 1_000_000;
