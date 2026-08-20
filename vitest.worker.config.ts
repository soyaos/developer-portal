import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: path.join(root, "tests/worker-entry.ts"),
      remoteBindings: false,
      wrangler: { configPath: path.join(root, "wrangler.jsonc") },
      miniflare: {
        bindings: {
          API_KEY_PEPPER: "worker-test-pepper-with-at-least-thirty-two-bytes",
          TEST_MIGRATIONS: await readD1Migrations(path.join(root, "migrations")),
        },
      },
    })),
  ],
  test: {
    include: ["tests/**/*.worker.test.ts"],
    setupFiles: ["./tests/worker-setup.ts"],
  },
});
