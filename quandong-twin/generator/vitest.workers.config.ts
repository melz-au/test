/**
 * Durable Object integration tests, run inside the Workers runtime (workerd) by
 * @cloudflare/vitest-plugin. A fake Databricks Files API runs in Node (global setup) and the
 * Worker's sink talks to it over HTTP, exactly as it would talk to Databricks.
 */
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export const FAKE_API_PORT = 8799;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          DATABRICKS_HOST: `http://127.0.0.1:${FAKE_API_PORT}`,
          DATABRICKS_TOKEN: "test-token",
          SCENARIO_API_KEY: "test-scenario-key-0123456789",
          LOCAL_MODE: "true",
          RANDOM_SCENARIOS_PER_SITE_DAY: "0",
        },
      },
    }),
  ],
  test: {
    include: ["test/workers/**/*.test.ts"],
    globalSetup: ["test/workers/global-setup.ts"],
  },
});
