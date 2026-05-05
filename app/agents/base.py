# base.py — Shared agent invocation and model routing.
# Handles model selection, context injection (RAG + tone), and API calls.
import asyncio
import json
import re
import traceback
from typing import Optional

import anthropic

from config import ANTHROPIC_API_KEY, AGENT_MODELS, GENERAL_MODEL
from agents.agent1_intake import SYSTEM_PROMPT as INTAKE_PROMPT
from agents.agent2_resume import SYSTEM_PROMPT as RESUME_PROMPT
from agents.agent3_interview import SYSTEM_PROMPT as INTERVIEW_PROMPT
from agents.agent4_validator import SYSTEM_PROMPT as VALIDATOR_PROMPT
from tracing import Trace, logger

_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
_async_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

AGENT_PROMPTS: dict[str, str] = {
    "agent1": INTAKE_PROMPT,
    "agent2": RESUME_PROMPT,
    "agent3": INTERVIEW_PROMPT,
    "agent4": VALIDATOR_PROMPT,
}

_PANEL_RE = re.compile(
    r'\n*__PANEL_UPDATE__\n(\{.*?\})\n__END_PANEL__',
    re.DOTALL,
)


# ---------------------------------------------------------------------------
# Model routing
# ---------------------------------------------------------------------------

_GENERAL_PATTERNS = re.compile(
    r"^("
    r"hi|hello|hey|thanks?|thank you|ok|okay|got it|sure|sounds good|great|cool|perfect|nice|"
    r"yes|no|nope|yep|yup|agreed|understood|makes sense|noted|"
    r"what (is|are|does|can|do) |"
    r"can you (explain|tell me|help me understand|clarify)|"
    r"(how|why|when|where|who) (?!.*\b(resume|interview|job|career|offer|salary|role|company|application)\b)"
    r")",
    re.IGNORECASE,
)


def _is_general_query(message: str) -> bool:
    """Return True if the message is a simple/conversational query."""
    text = message.strip()
    if len(text) > 200:
        # Long messages are substantive — don't downgrade
        return False
    return bool(_GENERAL_PATTERNS.match(text))


def _get_model(agent_id: str, history: list, message: str = "") -> str:
    """Return the model string for this agent and interaction type.

    Agent 1: general/chitchat queries route to Haiku to save cost.
    Agent 2: first call (no prior assistant turn) → main rewrite → Sonnet
             subsequent calls → targeted edit → Haiku
    All other agents: single model.
    """
    # Downgrade to Haiku for simple conversational queries on agent1 only.
    # Other agents are doing specialized work that benefits from Sonnet.
    if agent_id == "agent1" and message and _is_general_query(message):
        logger.info("[MODEL] agent=%s mode=general model=%s", agent_id, GENERAL_MODEL)
        return GENERAL_MODEL

    config = AGENT_MODELS.get(agent_id, {"model": "claude-sonnet-4-6", "mode": "single"})
    if config.get("mode") == "single":
        model = config["model"]
        logger.info("[MODEL] agent=%s mode=single model=%s", agent_id, model)
        return model

    has_prior_response = any(m["role"] == "assistant" for m in history)
    if has_prior_response:
        model = config["targeted"]
        logger.info("[MODEL] agent=%s mode=targeted model=%s", agent_id, model)
    else:
        model = config["main"]
        logger.info("[MODEL] agent=%s mode=main model=%s", agent_id, model)
    return model


# ---------------------------------------------------------------------------
# Context injection
# ---------------------------------------------------------------------------

def _blocks_to_text(blocks: list[dict]) -> str:
    """Concatenate text blocks for logging/tracing (not sent to API)."""
    return "".join(b.get("text", "") for b in blocks)


async def _augment_system_prompt(
    agent_id: str,
    system_prompt: str,
    user_id: Optional[str],
    trace: Optional[Trace] = None,
) -> list[dict]:
    """Build system prompt as a content block array with cache_control on eligible blocks.

    Returns list[dict] for the Anthropic messages.stream(system=...) kwarg.
    Anthropic SDK accepts system as str or list[dict] — both are valid.

    Cache strategy:
      Agent 2 static block (~1,200–1,500 tok) → P2: cache_control ephemeral
      Agent 2 intake summary (~1,525–1,639 tok) → P3: second cache breakpoint
      Agent 3 injected context (~1,600–3,700 tok) → P4: cache_control ephemeral
    """
    static_block: dict = {"type": "text", "text": system_prompt}

    if user_id is None:
        if trace is not None:
            trace.context_injected = {"user_id": None}
        return [static_block]

    import db  # local import to avoid circular deps at module load

    ctx_info: dict = {}

    if agent_id in ("agent1", "agent4"):
        context = await db.retrieve_resume_context(user_id)
        if context and context.get("fact_sheet"):
            fs = context["fact_sheet"]
            history_str = ", ".join(
                f"v{s['version']}={s['score']}" for s in context.get("score_history", [])
            ) or "none"
            context_text = (
                "\n\n---\nRESUME CONTEXT (retrieved)\n"
                f"Version: {context['version']}\n"
                f"Job titles: {', '.join(fs.get('job_titles', []))}\n"
                f"Skills: {', '.join(fs.get('skills', []))}\n"
                f"Years experience: {fs.get('years_experience', 'unknown')}\n"
                f"Education: {', '.join(fs.get('education', []))}\n"
                f"Key achievements: {'; '.join(fs.get('key_achievements', []))}\n"
                f"Latest job fit score: {context.get('job_fit_score', 'N/A')}\n"
                f"Score history: {history_str}\n"
                "---"
            )
            ctx_info = {
                "resume_context": True,
                "version": context.get("version"),
                "job_fit_score": context.get("job_fit_score"),
                "skills_count": len(fs.get("skills", [])),
            }
            if trace is not None:
                trace.context_injected = ctx_info
            # Agent 1 static (~650 tok) is below the 1,024-token cache threshold — no cache_control.
            return [static_block, {"type": "text", "text": context_text}]
        else:
            ctx_info = {"resume_context": None}

    elif agent_id == "agent2":
        intake = await db.get_latest_document(user_id, "intake_summary")
        tone = await db.get_tone_descriptors(user_id)

        ctx_info = {
            "intake_summary": bool(intake and intake.get("content")),
            "tone_profile": list(tone["tone"]) if tone and tone.get("tone") else None,
        }

        # P2: Agent 2 static prompt (~1,200–1,500 tok) — mark for caching.
        cached_static = {**static_block, "cache_control": {"type": "ephemeral"}}
        blocks: list[dict] = [cached_static]

        if intake and intake.get("content"):
            # P3: Intake summary as a second cache breakpoint (~1,525–1,639 tok).
            blocks.append({
                "type": "text",
                "text": f"\n\n---\nPRE-LOADED CONTEXT\nIntake Summary (from Agent 1):\n{intake['content']}\n---",
                "cache_control": {"type": "ephemeral"},
            })

        if tone and tone.get("tone"):
            descriptors = ", ".join(tone["tone"])
            notes = tone.get("style_notes", "")
            blocks.append({
                "type": "text",
                "text": f"Tone Profile: {descriptors}\nStyle notes: {notes}",
            })

        if len(blocks) > 1:
            if trace is not None:
                trace.context_injected = ctx_info
            return blocks

    elif agent_id == "agent3":
        intake = await db.get_latest_document(user_id, "intake_summary")
        rewrite = await db.get_latest_document(user_id, "resume_rewrite")
        project_ctx = await db.get_latest_document(user_id, "project_context")  # P11

        ctx_info = {
            "intake_summary": bool(intake and intake.get("content")),
            "resume_rewrite": bool(rewrite and rewrite.get("content")),
            "project_context": bool(project_ctx and project_ctx.get("content")),
        }

        context_parts: list[str] = []
        if intake and intake.get("content"):
            context_parts.append(f"Intake Summary:\n{intake['content']}")
        if rewrite and rewrite.get("content"):
            context_parts.append(f"Latest Resume Rewrite:\n{rewrite['content']}")
        if project_ctx and project_ctx.get("content"):
            context_parts.append(f"Project Context:\n{project_ctx['content']}")  # P11

        if context_parts:
            # P4: Combined injected context (~1,600–3,700 tok) — cache it.
            context_text = "\n\n---\nPRE-LOADED CONTEXT\n" + "\n\n".join(context_parts) + "\n---"
            if trace is not None:
                trace.context_injected = ctx_info
            return [
                static_block,
                {"type": "text", "text": context_text, "cache_control": {"type": "ephemeral"}},
            ]

    if trace is not None:
        trace.context_injected = ctx_info if ctx_info else {"no_context": True}
    return [static_block]


# ---------------------------------------------------------------------------
# Message formatting
# ---------------------------------------------------------------------------

def _build_messages(history: list, user_message: str) -> list[dict]:
    """Convert session history + new user message into Anthropic messages format."""
    messages = [{"role": m["role"], "content": m["content"]} for m in history if m["role"] in ("user", "assistant")]
    messages.append({"role": "user", "content": user_message})
    return messages


# ---------------------------------------------------------------------------
# Trace persistence (fire-and-forget)
# ---------------------------------------------------------------------------

async def _save_trace(trace: Trace, user_id: Optional[str], conversation_id: Optional[str]) -> None:
    """Persist a completed trace to request_traces. Errors are logged, never re-raised."""
    try:
        import db
        await db.save_trace(trace, user_id=user_id, conversation_id=conversation_id)
    except Exception as e:
        logger.warning("[TRACE] failed to persist trace %s: %s", trace.trace_id, e)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def stream_agent(
    system_prompt: str,
    history: list,
    user_message: str,
    agent_id: str = "agent1",
    user_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    on_complete=None,
    on_panel=None,
):
    """Async generator that yields SSE data lines, then 'data: [DONE]', then 'data: [TRACE]'."""
    trace = Trace(agent_id=agent_id)
    trace.history_message_count = len(history)
    trace.user_message_preview = user_message[:200]

    model = _get_model(agent_id, history, message=user_message)
    trace.model = model

    augmented_blocks = await _augment_system_prompt(agent_id, system_prompt, user_id, trace=trace)
    augmented_text = _blocks_to_text(augmented_blocks)
    trace.system_prompt_length = len(augmented_text)
    trace.system_prompt_preview = augmented_text[:500]

    logger.info(
        "[AUGMENT] agent=%s user_id=%s context_injected=%s prompt_len=%d",
        agent_id, user_id, trace.context_injected, trace.system_prompt_length,
    )

    messages = _build_messages(history, user_message)

    full_response = ""
    try:
        async with _async_client.messages.stream(
            model=model,
            max_tokens=4096,
            system=augmented_blocks,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                full_response += text
                safe_text = text.replace("\n", "\\n")
                yield f"data: {safe_text}\n\n"

            try:
                final_message = await stream.get_final_message()
                usage = final_message.usage
                trace.input_tokens = usage.input_tokens
                trace.output_tokens = usage.output_tokens
                trace.cache_read_input_tokens = getattr(usage, "cache_read_input_tokens", None)
                trace.cache_creation_input_tokens = getattr(usage, "cache_creation_input_tokens", None)
            except Exception as usage_err:
                logger.warning("[TRACE] failed to collect token usage: %s", usage_err)

        # Extract and strip the PANEL_UPDATE block before handing off to on_complete
        panel_json = None
        m = _PANEL_RE.search(full_response)
        if m:
            try:
                panel_json = json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
            full_response = _PANEL_RE.sub("", full_response).rstrip()

        trace.response_length = len(full_response)
        trace.response_preview = full_response[:500]
        trace.token_count_approx = len(full_response.split())

        if on_complete:
            on_complete(full_response)

        # Phase 4: Mode A — run resume validation after Agent 2 completes.
        # Always yield a [VALIDATION] event so the result is never silently swallowed.
        if agent_id == "agent2" and user_id:
            try:
                from agents.agent4_validator import validate_resume
                import db
                context = await db.retrieve_resume_context(user_id)
                if context and context.get("fact_sheet"):
                    validation = await validate_resume(context["fact_sheet"], full_response)
                    trace.validation_result = validation
                    safe_val = json.dumps(validation).replace("\n", "\\n")
                    yield f"data: [VALIDATION] {safe_val}\n\n"
                else:
                    skipped = {"verdict": "skipped", "reason": "No resume fact sheet found. Upload a resume first.", "flags": []}
                    trace.validation_error = "No fact sheet available — validation skipped"
                    yield f"data: [VALIDATION] {json.dumps(skipped).replace(chr(10), chr(92) + 'n')}\n\n"
            except Exception as e:
                err_payload = {"verdict": "error", "reason": str(e), "flags": []}
                trace.validation_error = str(e)
                logger.error("[VALIDATION] agent2 validation failed: %s", e)
                yield f"data: [VALIDATION] {json.dumps(err_payload).replace(chr(10), chr(92) + 'n')}\n\n"

        if panel_json is not None:
            if on_panel:
                await on_panel(panel_json)
            safe_panel = json.dumps(panel_json).replace("\n", "\\n")
            yield f"data: [PANEL] {safe_panel}\n\n"

        yield "data: [DONE]\n\n"
        yield trace.to_sse_line()
        asyncio.create_task(_save_trace(trace, user_id, conversation_id))

    except Exception as e:
        logger.error("[STREAM] agent=%s unhandled exception: %s", agent_id, e)
        traceback.print_exc()
        trace.errors.append(str(e))
        yield f"data: [ERROR] {str(e)}\n\n"
        yield trace.to_sse_line()
        asyncio.create_task(_save_trace(trace, user_id, conversation_id))


# ---------------------------------------------------------------------------
# Phase 9 — Mode B: Interview coaching loop
# ---------------------------------------------------------------------------

def _load_interview_session(history: list) -> dict:
    """Find the most recent assistant message with interview_practice metadata."""
    for msg in reversed(history):
        if msg.get("role") == "assistant":
            meta = msg.get("metadata") or {}
            if meta.get("mode") == "interview_practice":
                return meta
    return {}


def _extract_questions_from_history(history: list) -> list[str]:
    """Parse Agent 3's question list from conversation history.

    Looks for lines starting with '**Question:**' in the last agent3 message.
    """
    for msg in reversed(history):
        if msg.get("role") == "assistant" and msg.get("agent_id") == 3:
            lines = msg["content"].split("\n")
            return [
                line.replace("**Question:**", "").strip()
                for line in lines
                if line.strip().startswith("**Question:**")
            ]
    return []


async def stream_interview_session(
    history: list,
    user_message: str,
    user_id: str,
    conversation_id: str,
    on_panel=None,
):
    """Mode B: Haiku eval → Sonnet coaching for each interview question.

    Async generator that yields SSE data lines followed by [PANEL] and [DONE].
    """
    from pathlib import Path
    import db

    eval_template = Path("prompts/agent4_interview_evaluation.txt").read_text()
    coaching_template = Path("prompts/agent4_interview_coaching.txt").read_text()

    # Restore or initialize session state
    session_meta = _load_interview_session(history)
    questions = session_meta.get("questions") or _extract_questions_from_history(history)
    q_idx = session_meta.get("question_index", 0)
    scores = session_meta.get("scores", [])
    follow_up_count = session_meta.get("follow_up_count", 0)

    # Load fact sheet for evaluation
    fact_sheet = {}
    context = await db.retrieve_resume_context(user_id)
    if context:
        fact_sheet = context.get("fact_sheet", {})

    current_question = questions[q_idx] if q_idx < len(questions) else None

    # Call 1: Haiku evaluation (structured JSON)
    eval_prompt = (
        eval_template
        .replace("{fact_sheet}", json.dumps(fact_sheet, indent=2))
        .replace("{question}", current_question or "")
        .replace("{answer}", user_message)
    )
    eval_trace = Trace(agent_id="agent4_eval")
    eval_trace.history_message_count = len(history)
    eval_trace.model = AGENT_MODELS["agent4_eval"]["model"]
    try:
        eval_response = await _async_client.messages.create(
            model=AGENT_MODELS["agent4_eval"]["model"],
            max_tokens=512,
            messages=[{"role": "user", "content": eval_prompt}],
        )
        eval_usage = eval_response.usage
        eval_trace.input_tokens = eval_usage.input_tokens
        eval_trace.output_tokens = eval_usage.output_tokens
        eval_trace.cache_read_input_tokens = getattr(eval_usage, "cache_read_input_tokens", None)
        eval_trace.cache_creation_input_tokens = getattr(eval_usage, "cache_creation_input_tokens", None)
        evaluation = json.loads(eval_response.content[0].text.strip())
    except Exception as e:
        eval_trace.errors.append(str(e))
        evaluation = {"score": 0, "gaps": [], "follow_up": None}
    asyncio.create_task(_save_trace(eval_trace, user_id, conversation_id))

    score = evaluation.get("score", 0)

    # Advance session state
    if score >= 90 or follow_up_count >= 2:
        scores.append(score)
        q_idx += 1
        follow_up_count = 0
    else:
        follow_up_count += 1

    session_complete = q_idx >= len(questions)

    new_meta = {
        "mode": "interview_practice",
        "question_index": q_idx,
        "total_questions": len(questions),
        "questions": questions,
        "scores": scores,
        "follow_up_count": follow_up_count,
        "session_complete": session_complete,
    }

    # Call 2: Sonnet coaching (streaming)
    coaching_prompt = coaching_template.replace(
        "{evaluation_json}", json.dumps(evaluation, indent=2)
    )

    coaching_trace = Trace(agent_id="agent4_coaching")
    coaching_trace.history_message_count = len(history)
    coaching_trace.model = AGENT_MODELS["agent4_coaching"]["model"]
    coaching_trace.system_prompt_length = len(coaching_prompt)

    full_response = ""
    try:
        async with _async_client.messages.stream(
            model=AGENT_MODELS["agent4_coaching"]["model"],
            max_tokens=2048,
            system=coaching_prompt,
            messages=_build_messages(history, user_message),
        ) as stream:
            async for text in stream.text_stream:
                full_response += text
                yield f"data: {text.replace(chr(10), chr(92) + 'n')}\n\n"

            try:
                final_message = await stream.get_final_message()
                usage = final_message.usage
                coaching_trace.input_tokens = usage.input_tokens
                coaching_trace.output_tokens = usage.output_tokens
                coaching_trace.cache_read_input_tokens = getattr(usage, "cache_read_input_tokens", None)
                coaching_trace.cache_creation_input_tokens = getattr(usage, "cache_creation_input_tokens", None)
            except Exception as usage_err:
                logger.warning("[TRACE] interview coaching usage capture failed: %s", usage_err)
    except Exception as e:
        coaching_trace.errors.append(str(e))
        asyncio.create_task(_save_trace(coaching_trace, user_id, conversation_id))
        yield f"data: [ERROR] {str(e)}\n\n"
        return

    coaching_trace.response_length = len(full_response)
    asyncio.create_task(_save_trace(coaching_trace, user_id, conversation_id))

    # Extract PANEL_UPDATE from coaching response
    panel_json = None
    m = _PANEL_RE.search(full_response)
    if m:
        try:
            panel_json = json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
        full_response = _PANEL_RE.sub("", full_response).rstrip()

    # Persist message with session metadata
    await db.append_message(conversation_id, "assistant", full_response, agent_id=4, metadata=new_meta)

    if panel_json is not None:
        if on_panel:
            await on_panel(panel_json)
        yield f"data: [PANEL] {json.dumps(panel_json).replace(chr(10), chr(92) + 'n')}\n\n"

    yield "data: [DONE]\n\n"


async def call_agent(
    system_prompt: str,
    history: list,
    user_message: str,
    agent_id: str = "agent1",
    user_id: Optional[str] = None,
) -> str:
    """Call the LLM and return the full response text."""
    model = _get_model(agent_id, history, message=user_message)
    augmented_blocks = await _augment_system_prompt(agent_id, system_prompt, user_id)
    logger.info("[CALL] agent=%s model=%s prompt_len=%d", agent_id, model, len(_blocks_to_text(augmented_blocks)))
    messages = _build_messages(history, user_message)

    response = await _async_client.messages.create(
        model=model,
        max_tokens=4096,
        system=augmented_blocks,
        messages=messages,
    )
    return response.content[0].text
