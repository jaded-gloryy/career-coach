Section 4 — PostgreSQL + Per-User Storage + Docker
What it is: Add Postgres to the Docker stack, define the user and document schema, and wire up per-session user creation on resume upload.
Tasks:
Docker:

Add postgres:16-alpine service to docker-compose.yml
Add pgvector extension (needed for Section 5)
Add DATABASE_URL env var to the app service
Add a db/init.sql run-once schema migration

Schema:
sql-- New user created on each resume upload (for now)
CREATE TABLE users (
    user_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ DEFAULT now(),
    tone_sample TEXT          -- raw writing sample, stored plaintext
);

CREATE TABLE documents (
    doc_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(user_id),
    role        TEXT NOT NULL,  -- resume | job_posting | writing_sample | other
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,  -- extracted plaintext
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resume_snapshots (
    snapshot_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(user_id),
    version      INT NOT NULL,
    content      TEXT NOT NULL,
    job_fit_score    INT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE session_state (
    user_id      UUID PRIMARY KEY REFERENCES users(user_id),
    job_title    TEXT,
    active_agent TEXT,
    sections_modified INT DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT now()
);

On resume upload: create new users row, insert documents row, create initial resume_snapshots entry at version 1
session_state row created alongside the user record
Expose user_id to the frontend (store in localStorage or session cookie) so subsequent requests are attributed to the correct user
Add a db/ module with get_conn(), create_user(), save_document(), save_snapshot(), load_user_context()

Depends on: Section 2 (multi-upload) — upload handler triggers user creation.