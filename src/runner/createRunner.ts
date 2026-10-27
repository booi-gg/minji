import { createNativeRunner } from "./native/runner.ts";
import type { Runner } from "./types.ts";

/** The runner chosen in step 0 (see specs/runner-decision.md). */
export const createRunner = (): Runner => createNativeRunner();
