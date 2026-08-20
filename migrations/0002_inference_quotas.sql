PRAGMA foreign_keys = ON;

CREATE TABLE inference_reservations (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  api_key_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'success', 'error')),
  reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
);

CREATE INDEX inference_reservations_tenant_created
  ON inference_reservations (tenant_id, created_at DESC);
CREATE INDEX inference_reservations_tenant_active
  ON inference_reservations (tenant_id, status, expires_at);

CREATE TRIGGER inference_concurrency_limit
BEFORE INSERT ON inference_reservations
WHEN (
  SELECT COUNT(*)
  FROM inference_reservations
  WHERE tenant_id = NEW.tenant_id
    AND status = 'active'
    AND expires_at > NEW.created_at
) >= 2
BEGIN
  SELECT RAISE(ABORT, 'inference_concurrency_limit');
END;

CREATE TRIGGER inference_rpm_limit
BEFORE INSERT ON inference_reservations
WHEN (
  SELECT COUNT(*)
  FROM inference_reservations
  WHERE tenant_id = NEW.tenant_id
    AND created_at > NEW.created_at - 60000
) >= 20
BEGIN
  SELECT RAISE(ABORT, 'inference_rpm_limit');
END;

CREATE TRIGGER inference_daily_request_limit
BEFORE INSERT ON inference_reservations
WHEN (
  SELECT COUNT(*)
  FROM inference_reservations
  WHERE tenant_id = NEW.tenant_id
    AND created_at >= NEW.created_at - (NEW.created_at % 86400000)
) >= 100
BEGIN
  SELECT RAISE(ABORT, 'inference_daily_request_limit');
END;

CREATE TRIGGER inference_daily_token_limit
BEFORE INSERT ON inference_reservations
WHEN COALESCE((
  SELECT SUM(
    CASE
      WHEN status = 'active' AND expires_at > NEW.created_at THEN reserved_tokens
      ELSE total_tokens
    END
  )
  FROM inference_reservations
  WHERE tenant_id = NEW.tenant_id
    AND created_at >= NEW.created_at - (NEW.created_at % 86400000)
), 0) + NEW.reserved_tokens > 100000
BEGIN
  SELECT RAISE(ABORT, 'inference_daily_token_limit');
END;
