# session.py — Unified conversation memory with Postgres backing.
#
# The in-memory dict is an L1 cache keyed by conversation_id.
# Postgres is the source of truth — container restarts are safe.
#
# Structure: { conversation_id: [{"role": ..., "content": ...}, ...] }

import uuid
from typing import Optional

_cache: dict[str, list] = {}


async def get_or_create(
    conversation_id: Optional[str],
    user_id: Optional[str],
    agent_id: Optional[int],
) -> tuple[str, list]:
    """Return (conversation_id, history).

    Lookup order:
      1. In-memory cache — fast path, no DB round-trip.
      2. Postgres — hydrates cache after a container restart.
      3. Create — new conversation row + empty history.
    """
    import db  # local import to avoid circular deps at module load

    if conversation_id is None:
        conversation_id = str(uuid.uuid4())

    if conversation_id in _cache:
        return conversation_id, _cache[conversation_id]

    # Cache miss — try to hydrate from DB
    history = await db.load_conversation_history(conversation_id)
    if history is not None:
        _cache[conversation_id] = history
    else:
        # Brand-new conversation
        await db.create_conversation(conversation_id, user_id)
        _cache[conversation_id] = []

    return conversation_id, _cache[conversation_id]


def append_to_cache(conversation_id: str, role: str, content: str) -> None:
    """Update the in-memory L1 cache. Always call before scheduling the DB write."""
    if conversation_id not in _cache:
        _cache[conversation_id] = []
    _cache[conversation_id].append({"role": role, "content": content})
