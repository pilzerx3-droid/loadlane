import { defineConfig } from "vitest/config";

// End-to-end tests start a whole application against a real database; under parallel load the
// default 5 second limit is too tight and produces false failures.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
