-- Answers to the agent's daily/weekly questions, plus a log of approved dispatch plans.
CREATE TABLE agent_answers (
  id SERIAL PRIMARY KEY,
  question_key TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  answered_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_answers_day ON agent_answers (answered_on DESC, question_key);

CREATE TABLE dispatch_plans (
  id SERIAL PRIMARY KEY,
  plan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  assignments JSONB NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
