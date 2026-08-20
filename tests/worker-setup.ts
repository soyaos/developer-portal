/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeEach } from "vitest";

interface WorkerTestEnv {
  DB: D1Database;
  TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
}

beforeEach(async () => {
  const testEnv = env as unknown as WorkerTestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM request_traces"),
    testEnv.DB.prepare("DELETE FROM usage_events"),
    testEnv.DB.prepare("DELETE FROM api_keys"),
    testEnv.DB.prepare("DELETE FROM tenants"),
  ]);
});
