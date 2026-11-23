-- Key-value document store for the Manager Desk (ported from the Command Layer):
-- gk/cfg, gk/checks, gk/tasks, gk/bonus, pulse/YYYY-MM-DD, weekly/YYYY-MM-DD
CREATE TABLE desk_docs (
  path TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
