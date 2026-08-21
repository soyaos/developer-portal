PRAGMA foreign_keys = ON;

CREATE TABLE operational_flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

INSERT INTO operational_flags (name, enabled, updated_at, note)
VALUES ('api_key_creation', 1, 0, 'enabled_by_default');

CREATE TRIGGER api_key_creation_operational_gate
BEFORE INSERT ON api_keys
WHEN COALESCE((
  SELECT enabled
  FROM operational_flags
  WHERE name = 'api_key_creation'
), 0) != 1
BEGIN
  SELECT RAISE(ABORT, 'api_key_creation_paused');
END;
