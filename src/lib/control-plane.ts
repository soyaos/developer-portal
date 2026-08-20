import type { Session } from "./session";

const ACTIVE_KEY_LIMIT = 3;
const REQUEST_LIMIT_PER_DAY = 100;
const TOKEN_LIMIT_PER_DAY = 100_000;
const METADATA_RETENTION_MS = 24 * 60 * 60 * 1000;
const KEY_SCOPES = ["models:read", "chat:write"] as const;

export class ControlPlaneError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneError";
  }
}

export interface Tenant {
  id: string;
  githubId: number;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiKey extends ApiKeySummary {
  rawKey: string;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes_json: string;
  created_at: number;
  last_used_at: number | null;
}

interface StoredApiKeyRow {
  id: string;
  tenant_id: string;
  secret_digest: string;
}

interface UsageTotalRow {
  requests: number;
  tokens: number;
}

interface UsageBreakdownRow {
  key_prefix: string | null;
  model: string;
  requests: number;
  tokens: number;
  errors: number;
  avg_latency_ms: number;
}

interface TraceRow {
  request_id: string;
  trace_id: string;
  key_prefix: string | null;
  model: string;
  status: "success" | "error";
  error_code: string | null;
  latency_ms: number;
  created_at: number;
}

export interface RequestMetadata {
  requestId: string;
  tenantId: string;
  apiKeyId: string;
  traceId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  statusCode: number;
  status: "success" | "error";
  errorCode?: string | null;
  latencyMs: number;
  createdAt?: number;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(byteLength: number): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function requirePepper(pepper: string): string {
  if (new TextEncoder().encode(pepper).length < 32) {
    throw new ControlPlaneError(
      503,
      "key_issuer_unavailable",
      "API key issuance is temporarily unavailable.",
    );
  }
  return pepper;
}

async function digestSecret(secret: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requirePepper(pepper)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret));
  return encodeBase64Url(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function asIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function keySummary(row: ApiKeyRow): ApiKeySummary {
  let scopes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.scopes_json);
    if (Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string")) {
      scopes = parsed;
    }
  } catch {
    // A malformed historical value should not make the entire key list unavailable.
  }
  return {
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    scopes,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: asIso(row.last_used_at),
  };
}

export async function ensureTenant(
  db: D1Database,
  session: Session,
  now = Date.now(),
): Promise<Tenant> {
  const id = `tenant_github_${session.githubId}`;
  await db
    .prepare(
      `INSERT INTO tenants (
        id, github_user_id, github_login, display_name, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT(github_user_id) DO UPDATE SET
        github_login = excluded.github_login,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at`,
    )
    .bind(id, session.githubId, session.login, session.name, now)
    .run();
  return { id, githubId: session.githubId };
}

export async function listApiKeys(db: D1Database, tenantId: string): Promise<ApiKeySummary[]> {
  const result = await db
    .prepare(
      `SELECT id, name, key_prefix, scopes_json, created_at, last_used_at
       FROM api_keys
       WHERE tenant_id = ?1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(tenantId)
    .all<ApiKeyRow>();
  return result.results.map(keySummary);
}

export async function createApiKey(
  db: D1Database,
  tenantId: string,
  rawName: string,
  pepper: string,
  now = Date.now(),
): Promise<CreatedApiKey> {
  const name = rawName.trim();
  if (!name || name.length > 64) {
    throw new ControlPlaneError(400, "invalid_key_name", "Key name must be 1–64 characters.");
  }

  const active = await db
    .prepare("SELECT COUNT(*) AS count FROM api_keys WHERE tenant_id = ?1 AND revoked_at IS NULL")
    .bind(tenantId)
    .first<{ count: number }>();
  if ((active?.count ?? 0) >= ACTIVE_KEY_LIMIT) {
    throw new ControlPlaneError(
      409,
      "active_key_limit",
      `A tenant can have at most ${ACTIVE_KEY_LIMIT} active API keys.`,
    );
  }

  const id = randomBase64Url(9);
  const secret = randomBase64Url(32);
  const prefix = `sk-soya-${id}`;
  const rawKey = `${prefix}.${secret}`;
  const secretDigest = await digestSecret(secret, pepper);
  try {
    await db
      .prepare(
        `INSERT INTO api_keys (
          id, tenant_id, name, key_prefix, secret_digest, scopes_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(id, tenantId, name, prefix, secretDigest, JSON.stringify(KEY_SCOPES), now)
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("active_api_key_limit")) {
      throw new ControlPlaneError(
        409,
        "active_key_limit",
        `A tenant can have at most ${ACTIVE_KEY_LIMIT} active API keys.`,
      );
    }
    throw error;
  }

  return {
    id,
    name,
    prefix,
    scopes: [...KEY_SCOPES],
    createdAt: new Date(now).toISOString(),
    lastUsedAt: null,
    rawKey,
  };
}

export async function revokeApiKey(
  db: D1Database,
  tenantId: string,
  keyId: string,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE api_keys
       SET revoked_at = COALESCE(revoked_at, ?1)
       WHERE id = ?2 AND tenant_id = ?3`,
    )
    .bind(now, keyId, tenantId)
    .run();
}

export async function verifyApiKey(
  db: D1Database,
  rawKey: string,
  pepper: string,
  now = Date.now(),
): Promise<{ keyId: string; tenantId: string } | null> {
  const match = /^sk-soya-([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/.exec(rawKey);
  const id = match?.[1] ?? "invalid_key_";
  const secret = match?.[2] ?? "invalid";
  const [stored, candidateDigest] = await Promise.all([
    db
      .prepare(
        `SELECT id, tenant_id, secret_digest
         FROM api_keys
         WHERE id = ?1 AND revoked_at IS NULL`,
      )
      .bind(id)
      .first<StoredApiKeyRow>(),
    digestSecret(secret, pepper),
  ]);
  const valid = constantTimeEqual(candidateDigest, stored?.secret_digest ?? "invalid-digest");
  if (!match || !stored || !valid) return null;
  await db
    .prepare("UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2 AND revoked_at IS NULL")
    .bind(now, stored.id)
    .run();
  return { keyId: stored.id, tenantId: stored.tenant_id };
}

export async function recordRequestMetadata(
  db: D1Database,
  metadata: RequestMetadata,
): Promise<void> {
  const createdAt = metadata.createdAt ?? Date.now();
  const expiresAt = createdAt + METADATA_RETENTION_MS;
  await db.batch([
    db
      .prepare(
        `INSERT INTO usage_events (
          request_id, tenant_id, api_key_id, model, prompt_tokens, completion_tokens,
          status_code, latency_ms, created_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        metadata.requestId,
        metadata.tenantId,
        metadata.apiKeyId,
        metadata.model,
        metadata.promptTokens,
        metadata.completionTokens,
        metadata.statusCode,
        metadata.latencyMs,
        createdAt,
        expiresAt,
      ),
    db
      .prepare(
        `INSERT INTO request_traces (
          request_id, tenant_id, api_key_id, trace_id, model, status, error_code,
          latency_ms, created_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        metadata.requestId,
        metadata.tenantId,
        metadata.apiKeyId,
        metadata.traceId,
        metadata.model,
        metadata.status,
        metadata.errorCode ?? null,
        metadata.latencyMs,
        createdAt,
        expiresAt,
      ),
  ]);
}

export async function purgeExpiredRequestMetadata(
  db: D1Database,
  now = Date.now(),
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM request_traces WHERE expires_at <= ?1").bind(now),
    db.prepare("DELETE FROM usage_events WHERE expires_at <= ?1").bind(now),
  ]);
}

export async function getUsage(db: D1Database, tenantId: string, now = Date.now()) {
  const from = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  const resetsAt = from + 24 * 60 * 60 * 1000;
  const [totalsResult, rowsResult] = await db.batch<UsageTotalRow | UsageBreakdownRow>([
    db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens
         FROM usage_events
         WHERE tenant_id = ?1 AND created_at >= ?2`,
      )
      .bind(tenantId, from),
    db
      .prepare(
        `SELECT k.key_prefix, e.model, COUNT(*) AS requests,
                COALESCE(SUM(e.prompt_tokens + e.completion_tokens), 0) AS tokens,
                SUM(CASE WHEN e.status_code >= 400 THEN 1 ELSE 0 END) AS errors,
                ROUND(AVG(e.latency_ms)) AS avg_latency_ms
         FROM usage_events e
         LEFT JOIN api_keys k ON k.id = e.api_key_id
         WHERE e.tenant_id = ?1 AND e.created_at >= ?2
         GROUP BY k.key_prefix, e.model
         ORDER BY requests DESC`,
      )
      .bind(tenantId, from),
  ]);
  const totals = (totalsResult.results[0] as UsageTotalRow | undefined) ?? {
    requests: 0,
    tokens: 0,
  };
  return {
    window: {
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
      resetsAt: new Date(resetsAt).toISOString(),
    },
    quota: {
      requestLimit: REQUEST_LIMIT_PER_DAY,
      requestUsed: totals.requests,
      tokenLimit: TOKEN_LIMIT_PER_DAY,
      tokenUsed: totals.tokens,
    },
    rows: (rowsResult.results as UsageBreakdownRow[]).map((row) => ({
      keyPrefix: row.key_prefix ?? "revoked/deleted",
      model: row.model,
      requests: row.requests,
      tokens: row.tokens,
      errors: row.errors,
      avgLatencyMs: row.avg_latency_ms,
    })),
  };
}

export async function listRequestTraces(
  db: D1Database,
  tenantId: string,
  now = Date.now(),
) {
  const from = now - METADATA_RETENTION_MS;
  const result = await db
    .prepare(
      `SELECT t.request_id, t.trace_id, k.key_prefix, t.model, t.status,
              t.error_code, t.latency_ms, t.created_at
       FROM request_traces t
       LEFT JOIN api_keys k ON k.id = t.api_key_id
       WHERE t.tenant_id = ?1 AND t.created_at >= ?2 AND t.expires_at > ?3
       ORDER BY t.created_at DESC
       LIMIT 50`,
    )
    .bind(tenantId, from, now)
    .all<TraceRow>();
  return result.results.map((row) => ({
    requestId: row.request_id,
    traceId: row.trace_id,
    keyPrefix: row.key_prefix ?? "revoked/deleted",
    model: row.model,
    status: row.status,
    errorCode: row.error_code,
    latencyMs: row.latency_ms,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
