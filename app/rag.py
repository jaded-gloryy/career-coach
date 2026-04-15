# rag.py — Tone extraction, resume fact-sheet compression, and embedding pipeline.
#
# Tone:     Haiku call → structured JSON descriptors stored in session_state
# Compress: Haiku call → ResumeFactSheet stored as JSONB on resume_snapshots
# Embed:    Ollama nomic-embed-text → vector(768) on resume_snapshots
#           Falls back gracefully when OLLAMA_BASE_URL is not set.

import json
import os
from typing import Optional

import httpx
from pydantic import BaseModel

from config import ANTHROPIC_API_KEY
import anthropic
from tracing import logger

_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

# ---------------------------------------------------------------------------
# Tone extraction
# ---------------------------------------------------------------------------

TONE_EXTRACTION_PROMPT = """\
Analyze this writing sample and extract 5-8 tone descriptors.
Return only JSON: {"tone": ["descriptor1", ...], "style_notes": "2 sentences"}
"""


class ToneProfile(BaseModel):
    tone: list[str]
    style_notes: str


async def extract_tone(writing_sample: str) -> dict:
    """Run a Haiku call to extract tone descriptors from a writing sample.
    Returns dict with keys 'tone' (list[str]) and 'style_notes' (str).
    Returns empty dict on failure."""
    try:
        response = await _client.messages.parse(
            model="claude-haiku-4-5",
            max_tokens=512,
            system=TONE_EXTRACTION_PROMPT,
            messages=[{"role": "user", "content": writing_sample}],
            output_format=ToneProfile,
        )
        if response.parsed_output is None:
            logger.warning("[TONE] parse returned None — model may have refused")
            return {}
        return response.parsed_output.model_dump()
    except Exception as e:
        logger.error("[TONE] extraction failed: %s", e)
        return {}


# ---------------------------------------------------------------------------
# Resume compression (fact sheet)
# ---------------------------------------------------------------------------

COMPRESS_PROMPT = """\
You are compressing a resume into a structured fact sheet for downstream analysis.
Extract the following and return as JSON only — no prose, no markdown fences.
Required fields: job_titles (list of strings), skills (list of strings),
years_experience (integer), education (list of strings),
key_achievements (list of strings).
"""


class ResumeFactSheet(BaseModel):
    job_titles: list[str]
    skills: list[str]
    years_experience: int
    education: list[str]
    key_achievements: list[str]
    job_fit_score: Optional[int] = None
    version: int


async def compress_resume(content: str, version: int, job_fit_score: Optional[int] = None) -> Optional[ResumeFactSheet]:
    """Compress resume text into a ResumeFactSheet via a Haiku structured-output call.
    Returns None on failure."""
    try:
        response = await _client.messages.parse(
            model="claude-haiku-4-5",
            max_tokens=1024,
            system=COMPRESS_PROMPT,
            messages=[{"role": "user", "content": content}],
            output_format=ResumeFactSheet,
        )
        if response.parsed_output is None:
            logger.warning("[COMPRESS] parse returned None")
            return None
        fact_sheet = response.parsed_output
        fact_sheet.version = version
        fact_sheet.job_fit_score = job_fit_score
        return fact_sheet
    except Exception as e:
        logger.error("[COMPRESS] failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Embedding via Ollama nomic-embed-text
# ---------------------------------------------------------------------------

async def embed_text(text: str) -> Optional[list[float]]:
    """Embed text using Ollama nomic-embed-text (768 dims).
    Returns None if OLLAMA_BASE_URL is not set or the call fails."""
    base_url = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
    if not base_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            r = await http.post(
                f"{base_url}/api/embed",
                json={"model": "nomic-embed-text", "input": text},
            )
            r.raise_for_status()
            data = r.json()
            return data["embeddings"][0]
    except Exception as e:
        logger.error("[EMBED] Ollama call failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# General document compaction (any role)
# ---------------------------------------------------------------------------

COMPACT_PROMPT = """\
Extract only the career-relevant information from this document into concise plain text.
Remove all formatting, boilerplate, and metadata. Return only the essential facts.
Do not add commentary. Do not use markdown. Maximum 400 words.
"""


async def compact_document_text(content: str, hint: str = "document") -> str:
    """Compact any document to a concise, LLM-friendly plain-text summary.
    Uses Haiku for speed and cost. Falls back to the original content on failure
    so no data is ever lost."""
    try:
        response = await _client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=600,
            system=COMPACT_PROMPT,
            messages=[{"role": "user", "content": f"Document type: {hint}\n\n{content}"}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.error("[COMPACT] failed for hint=%s: %s", hint, e)
        return content  # graceful fallback — never lose user data


# ---------------------------------------------------------------------------
# Full pipeline: compress + embed + persist
# ---------------------------------------------------------------------------

async def build_and_store_embedding(
    snapshot_id: str,
    content: str,
    version: int,
    job_fit_score: Optional[int] = None,
) -> None:
    """Compress resume to fact sheet, embed the JSON, and persist both.
    Designed to run as a background task — logs errors but does not raise."""
    from app import db  # local import to avoid circular deps at module load

    fact_sheet = await compress_resume(content, version, job_fit_score)
    if fact_sheet is None:
        return

    fact_sheet_dict = fact_sheet.model_dump()
    fact_sheet_json = json.dumps(fact_sheet_dict)

    embedding = await embed_text(fact_sheet_json)
    await db.store_snapshot_fact_sheet(snapshot_id, fact_sheet_dict, embedding)
    logger.info("[RAG] snapshot %s v%d — fact sheet stored, embedding=%s", snapshot_id, version, "yes" if embedding else "skipped")
