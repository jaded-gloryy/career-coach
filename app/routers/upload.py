# upload.py — File upload endpoints.
#
# POST /upload/resume
#   Creates a new user, saves the resume document, seeds snapshot v1,
#   and kicks off the RAG embedding pipeline in the background.
#   Returns user_id for the frontend to store in localStorage.
#
# POST /upload/document
#   Attaches an additional document (job_posting, writing_sample, other) to an
#   existing user. For writing_sample role, extracts tone and stores descriptors.

import io

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile

import db, rag
from middleware.auth import get_current_user
from db import get_or_create_user
from tracing import logger

router = APIRouter(prefix="/upload")


def _extract_text(filename: str, raw: bytes) -> str:
    if filename.endswith((".txt", ".md", ".rtf")):
        return raw.decode("utf-8", errors="replace")
    if filename.endswith(".json"):
        import json as _json
        try:
            data = _json.loads(raw.decode("utf-8", errors="replace"))
            return _json.dumps(data, indent=2, ensure_ascii=False)
        except Exception:
            return raw.decode("utf-8", errors="replace")
    if filename.endswith(".docx"):
        try:
            from docx import Document
            doc = Document(io.BytesIO(raw))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except ImportError:
            raise HTTPException(status_code=500, detail="python-docx not installed")
    raise HTTPException(status_code=400, detail="Only .txt, .md, .json, and .docx files are supported")


@router.post("/resume")
async def upload_resume(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    auth_id: str = Depends(get_current_user),
) -> dict:
    """Upload a resume. Creates a new user record and seeds snapshot v1."""
    user_id = await get_or_create_user(auth_id)

    filename = file.filename or ""
    raw = await file.read()
    text = _extract_text(filename, raw)
    compacted = await rag.compact_document_text(text, hint="resume")
    doc_id = await db.save_document(user_id, role="resume", filename=filename, content=text)
    snapshot_id = await db.save_snapshot(user_id, version=1, content=text)

    background_tasks.add_task(
        rag.build_and_store_embedding,
        snapshot_id=snapshot_id,
        content=text,
        version=1,
    )

    return {
        "user_id": user_id,
        "doc_id": doc_id,
        "extracted_text": compacted,
    }


_VALID_ROLES = {"resume", "job_posting", "writing_sample", "other"}


@router.post("/document")
async def upload_document(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    role: str = Form(...),
    auth_id: str = Depends(get_current_user),
) -> dict:
    """Attach an additional document to an existing user.
    For writing_sample role, tone extraction runs in the background."""
    user_id = await get_or_create_user(auth_id)
    if role not in _VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {sorted(_VALID_ROLES)}")

    filename = file.filename or ""
    raw = await file.read()
    text = _extract_text(filename, raw)
    compacted = await rag.compact_document_text(text, hint=role)

    doc_id = await db.save_document(user_id, role=role, filename=filename, content=text)

    if role == "writing_sample":
        background_tasks.add_task(_process_writing_sample, user_id, text)

    return {
        "user_id": user_id,
        "doc_id": doc_id,
        "role": role,
        "extracted_text": compacted,
    }


async def _process_writing_sample(user_id: str, text: str) -> None:
    """Extract tone descriptors and persist them. Runs as a background task."""
    tone = await rag.extract_tone(text)
    if tone:
        await db.save_tone(user_id, raw_sample=text, tone_descriptors=tone)
        logger.info("[TONE] user=%s descriptors=%s", user_id, tone.get('tone', []))
