# chat.py — POST /chat/{agent_id} and POST /chat/{agent_id}/stream

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app import db, session
from app.agents.base import AGENT_PROMPTS, call_agent, stream_agent, stream_interview_session
from app.middleware.auth import get_current_user
from app.db import get_or_create_user
from app.models import ChatRequest, ChatResponse, ConfirmSaveRequest

router = APIRouter()

_PRACTICE_INTENT_PHRASES = [
    "let's go", "lets go", "run me through", "start the practice",
    "i'm ready", "im ready", "begin", "start practicing", "go ahead",
]


def _is_practice_intent(message: str) -> bool:
    msg_lower = message.lower()
    return any(phrase in msg_lower for phrase in _PRACTICE_INTENT_PHRASES)


# Maps agent_id → document role used when persisting agent outputs
_AGENT_DOC_ROLES: dict[str, str] = {
    "agent1": "intake_summary",
    "agent2": "resume_rewrite",
    "agent3": "interview_prep",
    "agent4": "validation_report",
}

_AGENT_HANDOFFS: dict[str, dict] = {
    "agent1": {"next_agent": "agent2", "label": "Resume Coach", "message": "Intake complete — ready to work on your resume."},
    "agent2": {"next_agent": "agent3", "label": "Interview Coach", "message": "Resume ready — time to prep for interviews."},
}


def _agent_num(agent_id: str) -> int | None:
    """'agent1' → 1, 'agent2' → 2, etc. Returns None if not parseable."""
    try:
        return int(agent_id[-1])
    except (ValueError, IndexError):
        return None


@router.post("/chat/confirm-save")
async def confirm_save(body: ConfirmSaveRequest, auth_id: str = Depends(get_current_user)):
    """User confirms or skips saving an agent output to persistent memory."""
    if not body.confirmed:
        return {"status": "skipped"}
    user_id = await get_or_create_user(auth_id)
    doc_id = await db.save_document(
        user_id,
        role=body.role,
        filename=f"{body.role}.md",
        content=body.content,
    )
    return {"status": "saved", "doc_id": doc_id}


@router.get("/chat/conversations")
async def list_user_conversations(auth_id: str = Depends(get_current_user)):
    """Return all conversations for the current user, most recent first."""
    user_id = await get_or_create_user(auth_id)
    conversations = await db.list_conversations(user_id)
    return {"conversations": conversations}


@router.get("/chat/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str, auth_id: str = Depends(get_current_user)
):
    """Return the full message history and latest panel state for a single conversation."""
    history = await db.load_conversation_history(conversation_id)
    if history is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    panel_state = await db.get_conversation_panel_state(conversation_id)
    return {"messages": history, "panel_state": panel_state}


@router.post("/chat/{agent_id}", response_model=ChatResponse)
async def chat(agent_id: str, body: ChatRequest, auth_id: str = Depends(get_current_user)) -> ChatResponse:
    user_id = await get_or_create_user(auth_id)

    system_prompt = AGENT_PROMPTS.get(agent_id)
    if system_prompt is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_id}")

    num = _agent_num(agent_id)
    sid, history = await session.get_or_create(body.conversation_id, user_id, num)

    response_text = await call_agent(
        system_prompt, history, body.message,
        agent_id=agent_id, user_id=user_id,
    )

    session.append_to_cache(sid, "user", body.message)
    session.append_to_cache(sid, "assistant", response_text)
    await db.append_message(sid, "user", body.message)
    await db.append_message(sid, "assistant", response_text, agent_id=num)

    return ChatResponse(response=response_text, conversation_id=sid)


@router.post("/chat/{agent_id}/stream")
async def chat_stream(agent_id: str, body: ChatRequest, auth_id: str = Depends(get_current_user)):
    user_id = await get_or_create_user(auth_id)

    system_prompt = AGENT_PROMPTS.get(agent_id)
    if system_prompt is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_id}")

    num = _agent_num(agent_id)
    sid, history = await session.get_or_create(body.conversation_id, user_id, num)

    # Route Agent 3 + practice intent → Mode B interview coaching loop
    if agent_id == "agent3" and _is_practice_intent(body.message):
        asyncio.create_task(db.append_message(sid, "user", body.message))
        session.append_to_cache(sid, "user", body.message)

        async def on_panel_interview(panel_json: dict):
            await db.upsert_conversation_panel_state(sid, panel_json)

        return StreamingResponse(
            stream_interview_session(
                history=history,
                user_message=body.message,
                user_id=user_id,
                conversation_id=sid,
                on_panel=on_panel_interview,
            ),
            media_type="text/event-stream",
            headers={
                "X-Accel-Buffering": "no",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Conversation-Id": sid,
            },
        )

    doc_role = _AGENT_DOC_ROLES.get(agent_id, "other")
    # Agents whose outputs require user confirmation before persisting to memory.
    _CONFIRM_ROLES = {"intake_summary", "resume_rewrite", "interview_prep"}

    captured_response: list[str] = []  # mutable closure to pass response to wrapper

    def on_complete(full_response: str):
        captured_response.append(full_response)
        session.append_to_cache(sid, "user", body.message)
        session.append_to_cache(sid, "assistant", full_response)
        asyncio.create_task(db.append_message(sid, "user", body.message))
        asyncio.create_task(db.append_message(sid, "assistant", full_response, agent_id=num))
        # Document save is deferred for gated roles — user must confirm via [CONFIRM_SAVE].
        # For non-gated roles (e.g., validation_report), save immediately as before.
        if doc_role not in _CONFIRM_ROLES:
            asyncio.create_task(
                db.save_document(user_id, role=doc_role, filename=f"{doc_role}.md", content=full_response)
            )

    async def on_panel(panel_json: dict):
        await db.upsert_conversation_panel_state(sid, panel_json)

    async def _stream_with_confirm():
        """Wrap stream_agent and append [CONFIRM_SAVE] after [DONE] for gated roles."""
        async for chunk in stream_agent(
            system_prompt, history, body.message,
            agent_id=agent_id, user_id=user_id, conversation_id=sid,
            on_complete=on_complete, on_panel=on_panel,
        ):
            yield chunk
            # on_complete runs (synchronously) before [DONE] is yielded by stream_agent,
            # so captured_response is populated when we hit this branch.
            if chunk.strip() == "data: [DONE]" and doc_role in _CONFIRM_ROLES and captured_response:
                payload = json.dumps({
                    "role": doc_role,
                    "content": captured_response[0],
                    "conversation_id": sid,
                }).replace("\n", "\\n")
                yield f"data: [CONFIRM_SAVE] {payload}\n\n"
            if chunk.strip() == "data: [DONE]" and agent_id in _AGENT_HANDOFFS:
                is_agent1 = agent_id == "agent1"
                is_first_rewrite = agent_id == "agent2" and not any(m["role"] == "assistant" for m in history)
                if is_agent1 or is_first_rewrite:
                    handoff = _AGENT_HANDOFFS[agent_id]
                    yield f"data: [HANDOFF] {json.dumps(handoff)}\n\n"

    return StreamingResponse(
        _stream_with_confirm(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Conversation-Id": sid,
        },
    )
