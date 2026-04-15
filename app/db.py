# db.py — PostgreSQL connection pool and data access functions.
# Call init_pool() at app startup and close_pool() at shutdown.

import json
import os
import uuid
from typing import Optional

import asyncpg

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=os.environ["DATABASE_URL"],
        min_size=1,
        max_size=10,
    )


async def close_pool() -> None:
    if _pool:
        await _pool.close()


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialised — call init_pool() first")
    return _pool


# ---------------------------------------------------------------------------
# User + session creation
# ---------------------------------------------------------------------------

async def create_user() -> str:
    """Insert a new users row and a matching session_state row. Returns user_id."""
    pool = get_pool()
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users DEFAULT VALUES RETURNING user_id"
        )
        await conn.execute(
            "INSERT INTO session_state (user_id) VALUES ($1)", user_id
        )
    return str(user_id)


async def get_or_create_user(auth_id: str) -> str:
    """
    Look up or create the internal user row by Supabase auth_id.
    Returns the internal users.user_id as a string.
    Called on every authenticated request at the route boundary.
    """
    async with _pool.acquire() as conn:
        # Normal case: auth_id column is populated
        row = await conn.fetchrow(
            "SELECT user_id FROM users WHERE auth_id = $1", auth_id
        )
        if row:
            return str(row["user_id"])

        # Legacy case: pre-migration records where auth_id was stored directly
        # as user_id (before the auth_id column was added). Backfill auth_id
        # so future lookups hit the normal path.
        legacy_row = await conn.fetchrow(
            "SELECT user_id FROM users WHERE user_id = $1::uuid", auth_id
        )
        if legacy_row:
            await conn.execute(
                "UPDATE users SET auth_id = $1 WHERE user_id = $2::uuid",
                auth_id, auth_id,
            )
            return str(legacy_row["user_id"])

        new_id = uuid.uuid4()
        await conn.execute(
            "INSERT INTO users (user_id, auth_id) VALUES ($1, $2)",
            new_id, auth_id
        )
        await conn.execute(
            "INSERT INTO session_state (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
            new_id
        )
        return str(new_id)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

async def get_latest_document(user_id: str, role: str) -> Optional[dict]:
    """Return the most recent document for a user/role pair, or None if none exists."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT doc_id, role, filename, content, uploaded_at
            FROM documents
            WHERE user_id = $1 AND role = $2
            ORDER BY uploaded_at DESC
            LIMIT 1
            """,
            user_id, role,
        )
    return dict(row) if row else None


async def save_document(user_id: str, role: str, filename: str, content: str) -> str:
    """Insert a documents row. Returns doc_id."""
    pool = get_pool()
    async with pool.acquire() as conn:
        doc_id = await conn.fetchval(
            """
            INSERT INTO documents (user_id, role, filename, content)
            VALUES ($1, $2, $3, $4)
            RETURNING doc_id
            """,
            user_id, role, filename, content,
        )
    return str(doc_id)


# ---------------------------------------------------------------------------
# Resume snapshots
# ---------------------------------------------------------------------------

async def save_snapshot(
    user_id: str,
    version: int,
    content: str,
    job_fit_score: Optional[int] = None,
) -> str:
    """Insert a resume_snapshots row. Returns snapshot_id."""
    pool = get_pool()
    async with pool.acquire() as conn:
        snapshot_id = await conn.fetchval(
            """
            INSERT INTO resume_snapshots (user_id, version, content, job_fit_score)
            VALUES ($1, $2, $3, $4)
            RETURNING snapshot_id
            """,
            user_id, version, content, job_fit_score,
        )
    return str(snapshot_id)


async def store_snapshot_fact_sheet(
    snapshot_id: str,
    fact_sheet: dict,
    embedding: Optional[list[float]],
) -> None:
    """Persist the compressed fact sheet (JSONB) and optional vector embedding."""
    pool = get_pool()
    async with pool.acquire() as conn:
        if embedding is not None:
            vec_str = "[" + ",".join(str(x) for x in embedding) + "]"
            await conn.execute(
                """
                UPDATE resume_snapshots
                SET fact_sheet = $1::jsonb, embedding = $2::vector
                WHERE snapshot_id = $3
                """,
                json.dumps(fact_sheet), vec_str, snapshot_id,
            )
        else:
            await conn.execute(
                "UPDATE resume_snapshots SET fact_sheet = $1::jsonb WHERE snapshot_id = $2",
                json.dumps(fact_sheet), snapshot_id,
            )


# ---------------------------------------------------------------------------
# Tone
# ---------------------------------------------------------------------------

async def save_tone(user_id: str, raw_sample: str, tone_descriptors: dict) -> None:
    """Store raw writing sample on users row and structured descriptors on session_state."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE users SET tone_sample = $1 WHERE user_id = $2",
            raw_sample, user_id,
        )
        await conn.execute(
            "UPDATE session_state SET tone_descriptors = $1::jsonb WHERE user_id = $2",
            json.dumps(tone_descriptors), user_id,
        )


async def get_tone_descriptors(user_id: str) -> Optional[dict]:
    """Return tone_descriptors from session_state, or None if not set."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT tone_descriptors FROM session_state WHERE user_id = $1",
            user_id,
        )
    if row is None or row["tone_descriptors"] is None:
        return None
    raw = row["tone_descriptors"]
    return json.loads(raw) if isinstance(raw, str) else raw


# ---------------------------------------------------------------------------
# Context retrieval for agent injection
# ---------------------------------------------------------------------------

async def retrieve_resume_context(user_id: str) -> Optional[dict]:
    """Return the latest fact sheet and full job_fit_score history for a user.
    Returns None if no snapshots exist."""
    pool = get_pool()
    async with pool.acquire() as conn:
        latest = await conn.fetchrow(
            """
            SELECT version, fact_sheet, job_fit_score, created_at
            FROM resume_snapshots
            WHERE user_id = $1
            ORDER BY version DESC
            LIMIT 1
            """,
            user_id,
        )
        if latest is None:
            return None

        score_history = await conn.fetch(
            """
            SELECT version, job_fit_score
            FROM resume_snapshots
            WHERE user_id = $1 AND job_fit_score IS NOT NULL
            ORDER BY version
            """,
            user_id,
        )

    raw_fs = latest["fact_sheet"]
    fact_sheet = (json.loads(raw_fs) if isinstance(raw_fs, str) else raw_fs) if raw_fs else None

    return {
        "version": latest["version"],
        "fact_sheet": fact_sheet,
        "job_fit_score": latest["job_fit_score"],
        "score_history": [{"version": r["version"], "score": r["job_fit_score"]} for r in score_history],
    }


# ---------------------------------------------------------------------------
# Conversation memory (unified Postgres-backed store)
# ---------------------------------------------------------------------------

async def create_conversation(conversation_id: str, user_id: Optional[str]) -> None:
    """Insert a conversations row with the given ID. No-op if it already exists."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO conversations (id, user_id)
            VALUES ($1::uuid, $2::uuid)
            ON CONFLICT (id) DO NOTHING
            """,
            conversation_id, user_id,
        )


async def list_conversations(user_id: str) -> list[dict]:
    """Return conversation summaries for a user, most recent first (max 50)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.id, c.title, c.job_title, c.created_at,
                   m.content   AS last_message,
                   m.role      AS last_role,
                   m.created_at AS last_message_at
            FROM conversations c
            LEFT JOIN LATERAL (
                SELECT content, role, created_at
                FROM messages
                WHERE conversation_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
            ) m ON true
            WHERE c.user_id = $1
            ORDER BY COALESCE(m.created_at, c.created_at) DESC
            LIMIT 50
            """,
            user_id,
        )
    return [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "job_title": r["job_title"],
            "created_at": r["created_at"].isoformat(),
            "last_message": r["last_message"],
            "last_role": r["last_role"],
            "last_message_at": r["last_message_at"].isoformat() if r["last_message_at"] else None,
        }
        for r in rows
    ]


async def upsert_conversation_panel_state(conversation_id: str, panel_state: dict) -> None:
    """Merge-patch the Progress Panel state for a conversation.

    Uses jsonb_strip_nulls so null values in the new payload don't erase
    existing non-null values — mirrors the APPLY_PANEL merge logic on the frontend.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE conversations
            SET panel_state = COALESCE(panel_state, '{}'::jsonb) || jsonb_strip_nulls($1::jsonb)
            WHERE id = $2::uuid
            """,
            json.dumps(panel_state), conversation_id,
        )


async def get_conversation_panel_state(conversation_id: str) -> Optional[dict]:
    """Return the stored panel_state for a conversation, or None."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT panel_state FROM conversations WHERE id = $1::uuid", conversation_id
        )
    if row is None or row["panel_state"] is None:
        return None
    raw = row["panel_state"]
    return json.loads(raw) if isinstance(raw, str) else raw


async def load_conversation_history(conversation_id: str) -> Optional[list]:
    """Return ordered [{role, content, agent_id, metadata}] for a conversation, or None if not found."""
    pool = get_pool()
    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM conversations WHERE id = $1::uuid", conversation_id
        )
        if exists is None:
            return None
        rows = await conn.fetch(
            """
            SELECT role, content, agent_id, metadata
            FROM messages
            WHERE conversation_id = $1::uuid
            ORDER BY created_at
            """,
            conversation_id,
        )
    return [
        {
            "role": r["role"],
            "content": r["content"],
            "agent_id": r["agent_id"],
            "metadata": json.loads(r["metadata"]) if r["metadata"] else {},
        }
        for r in rows
    ]


async def append_message(
    conversation_id: str,
    role: str,
    content: str,
    agent_id: Optional[int] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Persist a message row. token_count is a char-based approximation."""
    token_count = len(content) // 4
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO messages (conversation_id, agent_id, role, content, token_count, metadata)
            VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)
            """,
            conversation_id, agent_id, role, content, token_count,
            json.dumps(metadata) if metadata else None,
        )


# ---------------------------------------------------------------------------
# Request traces (prompt-size and token-usage telemetry)
# ---------------------------------------------------------------------------

async def save_trace(trace, *, user_id: Optional[str], conversation_id: Optional[str]) -> None:
    """Persist a completed Trace to request_traces. Fire-and-forget safe."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO request_traces (
                trace_id, agent_id, model, user_id, conversation_id,
                input_tokens, output_tokens,
                cache_read_input_tokens, cache_creation_input_tokens,
                system_prompt_length, history_message_count,
                latency_ms, context_injected, errors
            ) VALUES (
                $1, $2, $3, $4::uuid, $5::uuid,
                $6, $7, $8, $9,
                $10, $11,
                $12, $13::jsonb, $14::jsonb
            )
            """,
            trace.trace_id,
            trace.agent_id,
            trace.model,
            user_id,
            conversation_id,
            trace.input_tokens,
            trace.output_tokens,
            trace.cache_read_input_tokens,
            trace.cache_creation_input_tokens,
            trace.system_prompt_length,
            trace.history_message_count,
            int(trace.latency_ms),
            json.dumps(trace.context_injected),
            json.dumps(trace.errors) if trace.errors else "[]",
        )


# ---------------------------------------------------------------------------
# General context load (used by upload endpoint)
# ---------------------------------------------------------------------------

async def load_user_context(user_id: str) -> dict:
    """Return user metadata, all documents, latest snapshot, and session state."""
    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT user_id, created_at, tone_sample FROM users WHERE user_id = $1",
            user_id,
        )
        if user is None:
            return {}

        documents = await conn.fetch(
            """
            SELECT doc_id, role, filename, content, uploaded_at
            FROM documents
            WHERE user_id = $1
            ORDER BY uploaded_at
            """,
            user_id,
        )

        snapshot = await conn.fetchrow(
            """
            SELECT snapshot_id, version, content, job_fit_score, created_at
            FROM resume_snapshots
            WHERE user_id = $1
            ORDER BY version DESC
            LIMIT 1
            """,
            user_id,
        )

        state = await conn.fetchrow(
            "SELECT job_title, active_agent, sections_modified FROM session_state WHERE user_id = $1",
            user_id,
        )

    return {
        "user_id": str(user["user_id"]),
        "created_at": user["created_at"].isoformat(),
        "tone_sample": user["tone_sample"],
        "documents": [dict(d) for d in documents],
        "latest_snapshot": dict(snapshot) if snapshot else None,
        "session_state": dict(state) if state else None,
    }
