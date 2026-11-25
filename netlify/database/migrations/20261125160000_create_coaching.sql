-- Manager coaching: short 1-on-1 meeting log and weekly role-play sessions/scores.
CREATE TABLE coach_meetings (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  met_on DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  skill TEXT,
  followup_on DATE,
  confidence SMALLINT CHECK (confidence BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coach_meetings_rep ON coach_meetings (rep_id, met_on DESC);

CREATE TABLE roleplay_sessions (
  id SERIAL PRIMARY KEY,
  held_on DATE NOT NULL DEFAULT CURRENT_DATE,
  skill TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE roleplay_scores (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
  rep_id INTEGER NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  attended BOOLEAN NOT NULL DEFAULT TRUE,
  score SMALLINT CHECK (score BETWEEN 1 AND 5)
);
CREATE INDEX idx_roleplay_scores_rep ON roleplay_scores (rep_id, session_id DESC);
