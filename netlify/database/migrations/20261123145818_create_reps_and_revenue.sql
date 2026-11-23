-- Canvasser roster, live status/location, activity log, and cached revenue
-- numbers pulled from SalesRabbit/AccuLynx.

CREATE TABLE reps (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  pin TEXT NOT NULL, -- 4-digit code the rep enters on the rep-facing page; not real auth
  status TEXT NOT NULL DEFAULT 'idle', -- idle | dispatched | on_site | done
  assigned_address TEXT,
  assigned_storm_id TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  location_updated_at TIMESTAMPTZ,
  doors_knocked INTEGER NOT NULL DEFAULT 0,
  appointments_set INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rep_activity_log (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- status_change | door_knocked | appointment_set | dispatched | location_ping
  event_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rep_activity_log_rep_id ON rep_activity_log (rep_id, created_at DESC);

CREATE TABLE revenue_snapshot (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL, -- salesrabbit | acculynx | manual
  total_sold_cents BIGINT NOT NULL DEFAULT 0,
  canvasser_sold_cents BIGINT NOT NULL DEFAULT 0,
  raw_meta JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_revenue_snapshot_fetched_at ON revenue_snapshot (fetched_at DESC);
