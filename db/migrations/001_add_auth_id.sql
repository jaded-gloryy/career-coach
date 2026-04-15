-- Migration 001: Add Supabase auth_id to users table
-- Run once against the running career_coach database

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
