# tracing.py — Lightweight per-request trace collector.
# Traces ride the existing SSE stream as [TRACE] events — no separate API needed.
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("career-coach")


@dataclass
class Trace:
    trace_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    agent_id: str = ""
    model: str = ""
    started_at: float = field(default_factory=time.time)
    # Context injection
    context_injected: dict = field(default_factory=dict)
    system_prompt_length: int = 0
    system_prompt_preview: str = ""   # first 500 chars only — no full PII
    history_message_count: int = 0
    # LLM call
    user_message_preview: str = ""    # first 200 chars
    response_length: int = 0
    response_preview: str = ""        # first 500 chars
    token_count_approx: int = 0       # legacy word-count estimate; prefer real token fields below
    # Real token usage from Anthropic API (populated after stream closes)
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cache_read_input_tokens: Optional[int] = None
    cache_creation_input_tokens: Optional[int] = None
    latency_ms: float = 0
    # Validation
    validation_result: Optional[dict] = None
    validation_error: Optional[str] = None
    # Errors
    errors: list = field(default_factory=list)

    def to_sse(self) -> dict:
        """Return serializable dict for SSE [TRACE] event."""
        self.latency_ms = round((time.time() - self.started_at) * 1000)
        return asdict(self)

    def to_sse_line(self) -> str:
        """Return a ready-to-yield SSE data line."""
        safe = json.dumps(self.to_sse()).replace("\n", "\\n")
        return f"data: [TRACE] {safe}\n\n"
