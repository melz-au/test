import { defineConfig } from "vitest/config";

// Unit tests for pure generator logic run in Node. Durable Object integration tests run in the
// Workers runtime via generator/vitest.workers.config.ts (`npm run test:do`).
export default defineConfig({
  test: {
    include: ["generator/test/**/*.test.ts"],
    exclude: ["generator/test/workers/**"],
  },
});
