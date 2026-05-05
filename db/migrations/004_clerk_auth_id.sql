-- Migration 004: Switch auth_id from UUID to TEXT for Clerk compatibility.
-- Clerk user IDs are strings (e.g. user_2abc123...), not UUIDs.
-- Run once against the running career_coach database.

-- Drop the old index before changing the column type
DROP INDEX IF EXISTS idx_users_auth_id;

-- Change column type; existing UUID values cast cleanly to text
ALTER TABLE users ALTER COLUMN auth_id TYPE TEXT USING auth_id::text;

-- Re-create the unique constraint and index on the new text column
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_id_key;
ALTER TABLE users ADD CONSTRAINT users_auth_id_key UNIQUE (auth_id);

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
