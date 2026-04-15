-- 003_add_request_traces.sql
-- Persistent telemetry table for per-request LLM traces.
-- Enables querying input token counts over time to detect prompt creep.

CREATE TABLE IF NOT EXISTS request_traces (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id                    TEXT NOT NULL,
    agent_id                    TEXT NOT NULL,
    model                       TEXT NOT NULL,
    user_id                     UUID REFERENCES users(user_id),
    conversation_id             UUID REFERENCES conversations(id),
    -- Real token counts from Anthropic API usage object
    input_tokens                INT,
    output_tokens               INT,
    cache_read_input_tokens     INT,
    cache_creation_input_tokens INT,
    -- Prompt shape metrics
    system_prompt_length        INT,   -- len(augmented system prompt in chars)
    history_message_count       INT,   -- number of prior messages sent to the API
    -- Performance
    latency_ms                  INT,
    -- Context injection and error details
    context_injected            JSONB,
    errors                      JSONB,
    created_at                  TIMESTAMPTZ DEFAULT now()
);

-- Primary query pattern: input_tokens over time per agent (prompt creep detection)
CREATE INDEX IF NOT EXISTS idx_request_traces_agent_created
    ON request_traces(agent_id, created_at);

-- Secondary: per-user trace history
CREATE INDEX IF NOT EXISTS idx_request_traces_user_created
    ON request_traces(user_id, created_at);
