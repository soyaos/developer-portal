import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  createApiKey,
  ensureTenant,
  expireSyntheticTenantMetadata,
  getUsage,
  listApiKeys,
  listRequestTraces,
  purgeExpiredRequestMetadata,
  recordRequestMetadata,
  resetSyntheticTenant,
  revokeApiKey,
  verifyApiKey,
} from "../src/lib/control-plane";
import { createSession } from "../src/lib/session";

interface WorkerTestEnv {
  DB: D1Database;
  API_KEY_PEPPER: string;
}

const testEnv = env as unknown as WorkerTestEnv;
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

function user(id: number, login: string) {
  return createSession({ id, login, name: login, avatarUrl: null }, NOW);
}

describe("Cloud control plane", () => {
  it("creates isolated personal tenants from immutable GitHub IDs", async () => {
    const first = await ensureTenant(testEnv.DB, user(101, "alice"), NOW);
    const second = await ensureTenant(testEnv.DB, user(202, "bob"), NOW);
    await ensureTenant(testEnv.DB, user(101, "alice-renamed"), NOW + 1000);

    expect(first.id).not.toBe(second.id);
    const rows = await testEnv.DB.prepare(
      "SELECT github_user_id, github_login FROM tenants ORDER BY github_user_id",
    ).all<{ github_user_id: number; github_login: string }>();
    expect(rows.results).toEqual([
      { github_user_id: 101, github_login: "alice-renamed" },
      { github_user_id: 202, github_login: "bob" },
    ]);
  });

  it("shows the raw key once, stores only its digest, and rejects it after revocation", async () => {
    const tenant = await ensureTenant(testEnv.DB, user(101, "alice"), NOW);
    const created = await createApiKey(
      testEnv.DB,
      tenant.id,
      "smoke",
      testEnv.API_KEY_PEPPER,
      NOW,
    );

    expect(created.rawKey).toMatch(/^sk-soya-[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(await listApiKeys(testEnv.DB, tenant.id)).toEqual([
      expect.objectContaining({ id: created.id, prefix: created.prefix, name: "smoke" }),
    ]);
    const stored = await testEnv.DB.prepare(
      "SELECT secret_digest, key_prefix FROM api_keys WHERE id = ?1",
    ).bind(created.id).first<{ secret_digest: string; key_prefix: string }>();
    expect(stored?.secret_digest).not.toContain(created.rawKey);
    expect(stored?.secret_digest).not.toContain(created.rawKey.split(".")[1]);
    expect(stored?.key_prefix).toBe(created.prefix);
    await expect(
      verifyApiKey(testEnv.DB, created.rawKey, testEnv.API_KEY_PEPPER, NOW + 1),
    ).resolves.toEqual({
      keyId: created.id,
      tenantId: tenant.id,
      scopes: ["models:read", "chat:write"],
    });

    await revokeApiKey(testEnv.DB, tenant.id, created.id, NOW + 2);
    await expect(
      verifyApiKey(testEnv.DB, created.rawKey, testEnv.API_KEY_PEPPER, NOW + 3),
    ).resolves.toBeNull();
  });

  it("enforces three active keys and keeps cross-tenant revocation harmless", async () => {
    const alice = await ensureTenant(testEnv.DB, user(101, "alice"), NOW);
    const bob = await ensureTenant(testEnv.DB, user(202, "bob"), NOW);
    const first = await createApiKey(testEnv.DB, alice.id, "one", testEnv.API_KEY_PEPPER, NOW);
    await createApiKey(testEnv.DB, alice.id, "two", testEnv.API_KEY_PEPPER, NOW + 1);
    await createApiKey(testEnv.DB, alice.id, "three", testEnv.API_KEY_PEPPER, NOW + 2);

    await expect(
      createApiKey(testEnv.DB, alice.id, "four", testEnv.API_KEY_PEPPER, NOW + 3),
    ).rejects.toMatchObject({
      status: 409,
      code: "active_key_limit",
    });

    await revokeApiKey(testEnv.DB, bob.id, first.id, NOW + 4);
    await expect(
      verifyApiKey(testEnv.DB, first.rawKey, testEnv.API_KEY_PEPPER, NOW + 5),
    ).resolves.toEqual({
      keyId: first.id,
      tenantId: alice.id,
      scopes: ["models:read", "chat:write"],
    });
  });

  it("fails closed when API key creation is paused and recovers after re-enabling", async () => {
    const tenant = await ensureTenant(testEnv.DB, user(101, "alice"), NOW);
    await testEnv.DB.prepare(
      "UPDATE operational_flags SET enabled = 0, updated_at = ?1, note = 'cost_drill' WHERE name = 'api_key_creation'",
    ).bind(NOW).run();

    await expect(
      createApiKey(testEnv.DB, tenant.id, "blocked", testEnv.API_KEY_PEPPER, NOW),
    ).rejects.toMatchObject({
      status: 503,
      code: "api_key_creation_paused",
      retryAfter: 300,
    });
    const blockedCount = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM api_keys WHERE tenant_id = ?1",
    ).bind(tenant.id).first<{ count: number }>();
    expect(blockedCount?.count).toBe(0);
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO api_keys (
          id, tenant_id, name, key_prefix, secret_digest, scopes_json, created_at
        ) VALUES ('direct_gate', ?1, 'direct', 'sk-soya-direct_gate', 'digest', '[]', ?2)`,
      ).bind(tenant.id, NOW).run(),
    ).rejects.toThrow(/api_key_creation_paused/);

    await testEnv.DB.prepare(
      "UPDATE operational_flags SET enabled = 1, updated_at = ?1, note = 'cost_drill_restored' WHERE name = 'api_key_creation'",
    ).bind(NOW + 1).run();
    await expect(
      createApiKey(testEnv.DB, tenant.id, "restored", testEnv.API_KEY_PEPPER, NOW + 1),
    ).resolves.toMatchObject({ name: "restored" });
  });

  it("aggregates usage per tenant and exposes only 24-hour trace metadata", async () => {
    const alice = await ensureTenant(testEnv.DB, user(101, "alice"), NOW);
    const bob = await ensureTenant(testEnv.DB, user(202, "bob"), NOW);
    const aliceKey = await createApiKey(testEnv.DB, alice.id, "alice", testEnv.API_KEY_PEPPER, NOW);
    const bobKey = await createApiKey(testEnv.DB, bob.id, "bob", testEnv.API_KEY_PEPPER, NOW);

    await recordRequestMetadata(testEnv.DB, {
      requestId: "req_alice",
      tenantId: alice.id,
      apiKeyId: aliceKey.id,
      traceId: "trace_alice",
      model: "soya:starter",
      promptTokens: 20,
      completionTokens: 30,
      statusCode: 200,
      status: "success",
      latencyMs: 125,
      createdAt: NOW,
    });
    await recordRequestMetadata(testEnv.DB, {
      requestId: "req_bob",
      tenantId: bob.id,
      apiKeyId: bobKey.id,
      traceId: "trace_bob",
      model: "soya:starter",
      promptTokens: 500,
      completionTokens: 500,
      statusCode: 500,
      status: "error",
      errorCode: "upstream_error",
      latencyMs: 999,
      createdAt: NOW,
    });

    const usage = await getUsage(testEnv.DB, alice.id, NOW + 1);
    expect(usage.quota).toMatchObject({ requestUsed: 1, tokenUsed: 50 });
    expect(usage.rows).toEqual([
      expect.objectContaining({ keyPrefix: aliceKey.prefix, model: "soya:starter", requests: 1 }),
    ]);
    const traces = await listRequestTraces(testEnv.DB, alice.id, NOW + 1);
    expect(traces).toEqual([
      expect.objectContaining({ requestId: "req_alice", traceId: "trace_alice" }),
    ]);
    expect(JSON.stringify(traces)).not.toContain("req_bob");

    const columns = await testEnv.DB.prepare("PRAGMA table_info(request_traces)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["prompt", "response", "messages", "body"]),
    );
  });

  it("purges usage and traces at their 24-hour expiry", async () => {
    const tenant = await ensureTenant(testEnv.DB, user(101, "alice"), NOW);
    const key = await createApiKey(testEnv.DB, tenant.id, "smoke", testEnv.API_KEY_PEPPER, NOW);
    await recordRequestMetadata(testEnv.DB, {
      requestId: "req_expiring",
      tenantId: tenant.id,
      apiKeyId: key.id,
      traceId: "trace_expiring",
      model: "soya:starter",
      promptTokens: 1,
      completionTokens: 1,
      statusCode: 200,
      status: "success",
      latencyMs: 1,
      createdAt: NOW,
    });
    await purgeExpiredRequestMetadata(testEnv.DB, NOW + 24 * 60 * 60 * 1000);

    const usageCount = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM usage_events")
      .first<{ count: number }>();
    const traceCount = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM request_traces")
      .first<{ count: number }>();
    expect(usageCount?.count).toBe(0);
    expect(traceCount?.count).toBe(0);
  });

  it("limits staging maintenance to the selected synthetic tenant", async () => {
    const firstGitHubID = 9_007_199_254_740_001;
    const secondGitHubID = 9_007_199_254_740_002;
    const first = await ensureTenant(testEnv.DB, user(firstGitHubID, "soyaos-e2e-a"), NOW);
    const second = await ensureTenant(testEnv.DB, user(secondGitHubID, "soyaos-e2e-b"), NOW);
    const firstKey = await createApiKey(
      testEnv.DB,
      first.id,
      "first",
      testEnv.API_KEY_PEPPER,
      NOW,
    );
    await createApiKey(testEnv.DB, second.id, "second", testEnv.API_KEY_PEPPER, NOW);
    await recordRequestMetadata(testEnv.DB, {
      requestId: "req_synthetic_expiring",
      tenantId: first.id,
      apiKeyId: firstKey.id,
      traceId: "trace_synthetic_expiring",
      model: "soya:starter",
      promptTokens: 1,
      completionTokens: 1,
      statusCode: 200,
      status: "success",
      latencyMs: 1,
      createdAt: NOW,
    });

    await expireSyntheticTenantMetadata(testEnv.DB, firstGitHubID);
    await expect(listRequestTraces(testEnv.DB, first.id, NOW + 1)).resolves.toEqual([]);
    const expiredCount = await testEnv.DB
      .prepare("SELECT COUNT(*) AS count FROM request_traces WHERE tenant_id = ?1")
      .bind(first.id)
      .first<{ count: number }>();
    expect(expiredCount?.count).toBe(0);

    await resetSyntheticTenant(testEnv.DB, firstGitHubID);
    const tenants = await testEnv.DB
      .prepare("SELECT github_user_id FROM tenants ORDER BY github_user_id")
      .all<{ github_user_id: number }>();
    expect(tenants.results).toEqual([{ github_user_id: secondGitHubID }]);
    await expect(listApiKeys(testEnv.DB, second.id)).resolves.toHaveLength(1);
  });
});
