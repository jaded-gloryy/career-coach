Task brief: unified conversation memory

## OBJECTIVE
Replace the split session storage model (in-memory dict + Postgres) with a unified Postgres-backed message store. After this work, container restarts must not lose conversation history, and each agent must be able to reconstruct its full context from the database alone.
## NEW TABLES
conversations
| Column      | Type        | Description                          |
|-------------|-------------|--------------------------------------|
| id          | UUID (PK)   | Primary key                          |
| user_id     | UUID (FK)   | References users                     |
| title       | TEXT        | e.g. "Senior Eng @ Stripe"           |
| job_title   | TEXT        | Denormalized from session_state      |
| status      | TEXT        | active \| completed \| archived      |
| created_at  | TIMESTAMPTZ| Timestamp with time zone             |
messages
| Column           | Type           | Description                               |
|------------------|----------------|-------------------------------------------|
| id               | UUID (PK)      | Primary key                               |
| conversation_id  | UUID (FK)      | References conversations                  |
| agent_id         | INT            | 1–4, NULL for user turns                  |
| role             | TEXT           | user \| assistant \| system               |
| content          | TEXT           | Message content                           |
| token_count      | INT            | Stored at write time                      |
| metadata         | JSONB          | Panel updates, scores, flags              |
| created_at       | TIMESTAMPTZ    | Timestamp with time zone                  |

Index
messages(conversation_id, agent_id, created_at) — fast per-agent history retrieval

## DELIVERY STEPS
1. Migration
    Add conversations and messages tables via Alembic migration or raw SQL in Docker init. Verify with pgvector-compatible Postgres 16.
2. Dual-write in session.py
    On every message append, write to both the in-memory dict and Postgres. No read path change yet — this is purely additive and safe to ship immediately.
3. Hydration on miss
    Change the in-memory read path to fall back to Postgres when a session key is absent. In-memory dict becomes an L1 cache; Postgres is the source of truth. Container restarts are now safe.
4. conversation_id wiring
    Create a conversation row on first user message if none exists. Propagate conversation_id through the agent call chain so all messages link back correctly.
5. session_state cleanup
    Strip durable fields (job_title, tone_descriptors) from session_state that are now redundant with conversations. Leave only ephemeral UI state (active_agent, sections_modified).
6. Smoke test
    Restart the container mid-conversation and verify Agent 3 can reconstruct context from the DB without loss. Check token_count is populated on all messages.
## RISKS AND NOTES
agent_id = NULL for user messages — user turns belong to the conversation, not a specific agent. Queries for per-agent history should filter on role = 'assistant' AND agent_id = N, not just agent_id.
token_count at write time — approximate is fine. Use a simple character-based estimate or tiktoken if already available. Exact counts matter later for compression; right now you just need the column populated.
Panel update blobs in content — __PANEL_UPDATE__ blocks are stripped by base.py before the SSE stream. Store the stripped content in content and the extracted panel JSON in metadata. Keeps content clean for context reconstruction.
No backfill needed — 2 users, MVP. Start clean. Existing in-memory sessions will hydrate naturally as users continue conversations.
## OUT OF SCOPE FOR THIS TASK
Context compression · semantic retrieval via pgvector · Agent 4 validation routing · conversation list UI · auth