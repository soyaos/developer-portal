import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  handleChatCompletionsRequest,
  handleModelsRequest,
  PUBLIC_MODEL_ID,
} from "../src/lib/inference-api";
import {
  beginInference,
  createApiKey,
  ensureTenant,
  finalizeInference,
  getUsage,
  listRequestTraces,
} from "../src/lib/control-plane";
import { createSession } from "../src/lib/session";

interface WorkerTestEnv {
  DB: D1Database;
  API_KEY_PEPPER: string;
}

const testEnv = env as unknown as WorkerTestEnv;
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

async function createTestKey() {
  const session = createSession(
    { id: 303, login: "cloud-smoke", name: "Cloud Smoke", avatarUrl: null },
    NOW,
  );
  const tenant = await ensureTenant(testEnv.DB, session, NOW);
  const key = await createApiKey(
    testEnv.DB,
    tenant.id,
    "inference test",
    testEnv.API_KEY_PEPPER,
    NOW,
  );
  return { tenant, key };
}

function authorizedRequest(path: string, rawKey: string, body?: unknown): Request {
  return new Request(`https://api.soyaos.ai${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${rawKey}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function insertCompletedReservation(
  requestId: string,
  tenantId: string,
  apiKeyId: string,
  createdAt: number,
  totalTokens = 1,
) {
  await testEnv.DB.prepare(
    `INSERT INTO inference_reservations (
      request_id, tenant_id, api_key_id, model, status, reserved_tokens,
      total_tokens, created_at, expires_at, completed_at
    ) VALUES (?1, ?2, ?3, ?4, 'success', ?5, ?5, ?6, ?7, ?6)`,
  )
    .bind(
      requestId,
      tenantId,
      apiKeyId,
      PUBLIC_MODEL_ID,
      totalTokens,
      createdAt,
      createdAt + 5 * 60 * 1000,
    )
    .run();
}

describe("OpenAI-compatible inference data plane", () => {
  it("authenticates model discovery and returns only the public alias", async () => {
    const { key } = await createTestKey();
    const response = await handleModelsRequest(
      authorizedRequest("/v1/models", key.rawKey),
      testEnv,
      { now: () => NOW + 1 },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^req_[a-f0-9]{32}$/);
    await expect(response.json()).resolves.toMatchObject({
      object: "list",
      data: [{ id: PUBLIC_MODEL_ID, object: "model", owned_by: "soyaos" }],
    });

    const rejected = await handleModelsRequest(
      new Request("https://api.soyaos.ai/v1/models"),
      testEnv,
      { now: () => NOW + 2 },
    );
    expect(rejected.status).toBe(401);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { type: "authentication_error", code: "invalid_api_key" },
    });
  });

  it("returns a non-streaming OpenAI envelope and records body-free metadata", async () => {
    const { tenant, key } = await createTestKey();
    const run = vi.fn(async () => ({
      response: "pong",
      usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
    }));
    const response = await handleChatCompletionsRequest(
      authorizedRequest("/v1/chat/completions", key.rawKey, {
        model: PUBLIC_MODEL_ID,
        messages: [{ role: "user", content: "Reply with pong" }],
        max_tokens: 16,
      }),
      testEnv,
      { now: () => NOW + 10, run },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "chat.completion",
      model: PUBLIC_MODEL_ID,
      choices: [{ message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: false,
        maxTokens: 16,
        messages: [{ role: "user", content: "Reply with pong" }],
      }),
    );

    const usage = await getUsage(testEnv.DB, tenant.id, NOW + 11);
    expect(usage.quota).toMatchObject({ requestUsed: 1, tokenUsed: 9 });
    const traces = await listRequestTraces(testEnv.DB, tenant.id, NOW + 11);
    expect(traces).toEqual([
      expect.objectContaining({ model: PUBLIC_MODEL_ID, status: "success" }),
    ]);
    expect(JSON.stringify(traces)).not.toContain("Reply with pong");
  });

  it("relays Workers AI SSE with backpressure and finalizes usage before DONE", async () => {
    const { tenant, key } = await createTestKey();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encode = new TextEncoder();
        controller.enqueue(encode.encode('data: {"response":"soy"}\n\n'));
        controller.enqueue(
          encode.encode(
            'data: {"response":"a","usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
          ),
        );
        controller.enqueue(encode.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const response = await handleChatCompletionsRequest(
      authorizedRequest("/v1/chat/completions", key.rawKey, {
        model: PUBLIC_MODEL_ID,
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      }),
      testEnv,
      { now: () => NOW + 20, run: async () => upstream },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const streamBody = await response.text();
    expect(streamBody).toContain('"delta":{"role":"assistant"}');
    expect(streamBody).toContain('"delta":{"content":"soy"}');
    expect(streamBody).toContain('"delta":{"content":"a"}');
    expect(streamBody).toContain("data: [DONE]");

    const usage = await getUsage(testEnv.DB, tenant.id, NOW + 21);
    expect(usage.quota).toMatchObject({ requestUsed: 1, tokenUsed: 5 });
    const reservation = await testEnv.DB.prepare(
      "SELECT status, total_tokens FROM inference_reservations",
    ).first<{ status: string; total_tokens: number }>();
    expect(reservation).toEqual({ status: "success", total_tokens: 5 });
  });

  it("rejects invalid requests before invoking Workers AI or consuming quota", async () => {
    const { tenant, key } = await createTestKey();
    const run = vi.fn();
    const response = await handleChatCompletionsRequest(
      authorizedRequest("/v1/chat/completions", key.rawKey, {
        model: "private-internal-model",
        messages: [{ role: "user", content: "hello" }],
      }),
      testEnv,
      { now: () => NOW + 30, run },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { type: "invalid_request_error", code: "model_not_found" },
    });
    expect(run).not.toHaveBeenCalled();
    const usage = await getUsage(testEnv.DB, tenant.id, NOW + 31);
    expect(usage.quota.requestUsed).toBe(0);
    const reservations = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM inference_reservations",
    ).first<{ count: number }>();
    expect(reservations?.count).toBe(0);
  });

  it("enforces tenant concurrency and returns a retry hint", async () => {
    const { tenant, key } = await createTestKey();
    for (const requestId of ["req_active_one", "req_active_two"]) {
      await beginInference(testEnv.DB, {
        requestId,
        tenantId: tenant.id,
        apiKeyId: key.id,
        model: PUBLIC_MODEL_ID,
        reservedTokens: 10,
        createdAt: NOW + 40,
      });
    }

    await expect(
      beginInference(testEnv.DB, {
        requestId: "req_active_three",
        tenantId: tenant.id,
        apiKeyId: key.id,
        model: PUBLIC_MODEL_ID,
        reservedTokens: 10,
        createdAt: NOW + 41,
      }),
    ).rejects.toMatchObject({
      status: 429,
      code: "concurrency_limit",
      retryAfter: 5,
    });

    await finalizeInference(testEnv.DB, {
      requestId: "req_active_one",
      tenantId: tenant.id,
      apiKeyId: key.id,
      traceId: "trace_active_one",
      model: PUBLIC_MODEL_ID,
      promptTokens: 1,
      completionTokens: 1,
      statusCode: 200,
      status: "success",
      latencyMs: 1,
      createdAt: NOW + 40,
    });
    await expect(
      beginInference(testEnv.DB, {
        requestId: "req_after_release",
        tenantId: tenant.id,
        apiKeyId: key.id,
        model: PUBLIC_MODEL_ID,
        reservedTokens: 10,
        createdAt: NOW + 42,
      }),
    ).resolves.toBeUndefined();
  });

  it("enforces the rolling 20 requests-per-minute quota", async () => {
    const { tenant, key } = await createTestKey();
    for (let index = 0; index < 20; index += 1) {
      await insertCompletedReservation(
        `req_rpm_${index}`,
        tenant.id,
        key.id,
        NOW + index,
      );
    }

    await expect(
      beginInference(testEnv.DB, {
        requestId: "req_rpm_blocked",
        tenantId: tenant.id,
        apiKeyId: key.id,
        model: PUBLIC_MODEL_ID,
        reservedTokens: 1,
        createdAt: NOW + 20,
      }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limit", retryAfter: 60 });
  });

  it("enforces the 100 requests-per-day quota at the UTC boundary", async () => {
    const { tenant, key } = await createTestKey();
    for (let index = 0; index < 100; index += 1) {
      await insertCompletedReservation(
        `req_daily_${index}`,
        tenant.id,
        key.id,
        NOW + index * 60_001,
      );
    }
    const blockedAt = NOW + 100 * 60_001;

    await expect(
      beginInference(testEnv.DB, {
        requestId: "req_daily_blocked",
        tenantId: tenant.id,
        apiKeyId: key.id,
        model: PUBLIC_MODEL_ID,
        reservedTokens: 1,
        createdAt: blockedAt,
      }),
    ).rejects.toMatchObject({ status: 429, code: "daily_request_limit" });
  });

  it("reserves output tokens before inference to enforce the daily token quota", async () => {
    const { tenant, key } = await createTestKey();
    await insertCompletedReservation(
      "req_tokens_used",
      tenant.id,
      key.id,
      NOW,
      99_500,
    );

    await expect(
      beginInference(testEnv.DB, {
        requestId: "req_tokens_blocked",
        tenantId: tenant.id,
        apiKeyId: key.id,
        model: PUBLIC_MODEL_ID,
        reservedTokens: 501,
        createdAt: NOW + 1,
      }),
    ).rejects.toMatchObject({ status: 429, code: "daily_token_limit" });
  });
});
