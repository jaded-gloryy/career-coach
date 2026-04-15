-- 002_conversation_panel_state.sql
-- Add panel_state JSONB to conversations so each conversation can
-- persist and restore its Progress Panel data across sessions.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS panel_state JSONB;
