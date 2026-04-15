-- init.sql — Run-once schema migration for career-coach.
-- Executed automatically by Postgres on first container start.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";    -- pgvector

CREATE TABLE IF NOT EXISTS users (
    user_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ DEFAULT now(),
    tone_sample TEXT          -- raw writing sample, stored plaintext
);

CREATE TABLE IF NOT EXISTS documents (
    doc_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(user_id),
    role        TEXT NOT NULL,  -- resume | job_posting | writing_sample | other
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,  -- extracted plaintext
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resume_snapshots (
    snapshot_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(user_id),
    version       INT NOT NULL,
    content       TEXT NOT NULL,
    job_fit_score INT,
    fact_sheet    JSONB,           -- compressed ResumeFactSheet JSON
    embedding     vector(768),     -- nomic-embed-text produces 768-dim vectors
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_state (
    user_id           UUID PRIMARY KEY REFERENCES users(user_id),
    job_title         TEXT,
    active_agent      TEXT,
    sections_modified INT DEFAULT 0,
    tone_descriptors  JSONB,        -- extracted from writing sample
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(user_id),
    title       TEXT,
    job_title   TEXT,
    status      TEXT DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id         INT,             -- 1-4 for assistant turns, NULL for user turns
    role             TEXT NOT NULL,   -- user | assistant
    content          TEXT NOT NULL,
    token_count      INT,             -- approximate; len(content) // 4
    metadata         JSONB,           -- panel update JSON, flags, etc.
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_agent_time
    ON messages(conversation_id, agent_id, created_at);
