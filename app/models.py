# models.py — Pydantic request/response schemas for the API.

from typing import Optional

from pydantic import BaseModel


class AgentPanelUpdate(BaseModel):
    job_fit_score: Optional[int] = None    # 0-100; Agent 1 (estimate) and Agent 4 (authoritative)
    job_title: Optional[str] = None        # Agent 1 only
    last_action: Optional[str] = None      # short label; all agents
    sections_modified: Optional[int] = None


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str


class ChatResponse(BaseModel):
    response: str
    conversation_id: str


class SaveFileRequest(BaseModel):
    filename: str
    content: str


class SaveFileResponse(BaseModel):
    path: str


class ListFilesResponse(BaseModel):
    files: list[str]


class ConfirmSaveRequest(BaseModel):
    conversation_id: str
    role: str
    content: str  # possibly edited by user before confirming
    confirmed: bool
