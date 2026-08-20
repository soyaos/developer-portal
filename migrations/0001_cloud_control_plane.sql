PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,
  secret_digest TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX api_keys_tenant_active_created
  ON api_keys (tenant_id, revoked_at, created_at DESC);

CREATE TRIGGER api_keys_active_limit
BEFORE INSERT ON api_keys
WHEN (
  SELECT COUNT(*)
  FROM api_keys
  WHERE tenant_id = NEW.tenant_id AND revoked_at IS NULL
) >= 3
BEGIN
  SELECT RAISE(ABORT, 'active_api_key_limit');
END;

CREATE TABLE usage_events (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  api_key_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
);

CREATE INDEX usage_events_tenant_created
  ON usage_events (tenant_id, created_at DESC);
CREATE INDEX usage_events_expiry ON usage_events (expires_at);

CREATE TABLE request_traces (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  api_key_id TEXT,
  trace_id TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_code TEXT,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
);

CREATE INDEX request_traces_tenant_created
  ON request_traces (tenant_id, created_at DESC);
CREATE INDEX request_traces_expiry ON request_traces (expires_at);
