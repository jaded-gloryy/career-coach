# Observability & Memory Confirmation Plan

## Problem Statement

When switching from Agent 1 (intake) → Agent 2 (resume), the resume agent hallucinated content because:
1. **No way to see what context was injected** — `_augment_system_prompt()` silently builds the prompt
2. **No way to see what the LLM returned** — responses stream to UI but aren't logged
3. **Documents auto-commit to DB without user review** — `on_complete` in `chat.py:99-112` immediately calls `db.save_document()` and `db.append_message()`
4. **Validator results are silently swallowed** — `base.py:188-200` catches exceptions and continues

## Architecture Decision

All observability data flows through a **single new SSE event type `[TRACE]`** that the frontend can render in a collapsible debug panel. No separate API endpoints needed — traces ride the existing stream.

---

## Phase 1: Structured Logging + Trace Capture

**Goal**: Replace all `print()` statements with structured logging and capture a per-request trace object that records what happened at each step.

### Files to modify:
- **NEW** `app/tracing.py` — Trace context manager + structured log setup
- `app/agents/base.py` lines 46, 52, 55, 208 — Replace prints, add trace capture
- `app/rag.py` lines 48, 52, 91, 98, 122, 150, 177 — Replace prints

### Implementation:

**`app/tracing.py`** — Lightweight trace collector:
```python
import logging, time, uuid
from dataclasses import dataclass, field, asdict

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("career-coach")

@dataclass
class Trace:
    trace_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    agent_id: str = ""
    model: str = ""
    started_at: float = field(default_factory=time.time)
    # Context injection
    context_injected: dict = field(default_factory=dict)  # what RAG/docs were found
    system_prompt_length: int = 0
    system_prompt_preview: str = ""  # first 500 chars of augmented prompt
    history_message_count: int = 0
    # LLM call
    user_message: str = ""
    response_length: int = 0
    response_preview: str = ""  # first 500 chars
    token_count_approx: int = 0
    latency_ms: float = 0
    # Validation
    validation_result: dict | None = None
    validation_error: str | None = None
    # Errors
    errors: list[str] = field(default_factory=list)

    def to_sse(self) -> dict:
        """Return serializable dict for SSE [TRACE] event."""
        self.latency_ms = round((time.time() - self.started_at) * 1000)
        return asdict(self)
```

**In `base.py`** — Thread trace through agent calls:

1. `_augment_system_prompt()` (lines 63-131): After building augmented prompt, record on trace:
   - `trace.context_injected` = dict of what was found/missing (e.g., `{"resume_context": true, "intake_summary": null, "tone": {"descriptors": [...]}}`)
   - `trace.system_prompt_length` = len(augmented)
   - `trace.system_prompt_preview` = augmented[:500]

2. `stream_agent()` (lines 149-209): Create trace at start, yield `[TRACE]` event after `[DONE]`:
   - After accumulating full_response: `trace.response_length`, `trace.response_preview`, `trace.token_count_approx`
   - After validation (line 188-200): `trace.validation_result` or `trace.validation_error`
   - Final yield: `f"data: [TRACE] {json.dumps(trace.to_sse())}\n\n"`

3. `call_agent()` (lines 351-369): Same trace capture, returned alongside response

4. Replace all `print(f"[MODEL]...")` with `logger.info(...)` and trace field assignment

**In `rag.py`** — Replace all prints with `logger.info/error`:
- Line 48: `logger.warning("[TONE] parse returned None")`
- Line 52: `logger.error(f"[TONE] extraction failed: {e}")`
- etc.

### Verification:
- `grep -r "print(" app/` returns 0 hits (all replaced)
- `grep -r "logger\." app/` shows structured logging in all files
- Stream response includes `[TRACE]` event after `[DONE]`

---

## Phase 2: Debug Panel in Frontend

**Goal**: Collapsible debug panel in the UI that renders trace data for each agent response.

### Files to modify:
- `app/static/index.html` — SSE handler (lines 995-1039), new debug panel UI + CSS

### Implementation:

**SSE Handler** — Add `[TRACE]` event parsing after `[DONE]` handler (~line 1008):
```javascript
if (data.startsWith('[TRACE] ')) {
    const trace = JSON.parse(data.slice(8));
    renderTracePanel(trace);
    continue;
}
```

**Debug Panel UI** — Collapsible panel below each assistant message bubble:
```html
<!-- Appended to each assistant message bubble -->
<details class="trace-panel">
  <summary class="trace-toggle">
    🔍 Debug · {model} · {latency_ms}ms · {token_count_approx} tokens
  </summary>
  <div class="trace-body">
    <div class="trace-section">
      <h4>Context Injected</h4>
      <pre>{context_injected as formatted JSON}</pre>
      <!-- Color-code: green=found, red=null/missing -->
    </div>
    <div class="trace-section">
      <h4>System Prompt Preview</h4>
      <pre>{system_prompt_preview}</pre>
      <span class="trace-meta">Full length: {system_prompt_length} chars</span>
    </div>
    <div class="trace-section">
      <h4>Validation</h4>
      <!-- Show verdict + flags if present, or error if failed -->
    </div>
  </div>
</details>
```

**CSS** — Minimal debug styling:
- `.trace-panel` collapsed by default, monospace font, muted colors
- Context items color-coded: green for present, red for null/missing
- Validation verdict: green for pass, amber for needs_revision, red for error

### Verification:
- Send message to Agent 2 → debug panel appears below response
- Debug panel shows context_injected with clear null indicators for missing data
- Validation section shows verdict or error (not hidden)

---

## Phase 3: Memory Confirmation Gate

**Goal**: Before auto-saving documents (intake summaries, resume rewrites) to the DB, show the user what will be saved and let them confirm/edit.

### Files to modify:
- `app/routers/chat.py` lines 99-112 — Defer document save, emit confirmation event
- `app/routers/chat.py` — New endpoint `POST /chat/confirm-save`
- `app/static/index.html` — Confirmation UI
- `app/models.py` — New request model

### Implementation:

**Change `on_complete` callback** (`chat.py:99-112`):
- Still append messages to conversation history (that's fine — it's the chat log)
- **Do NOT call `db.save_document()` immediately**
- Instead, yield a new SSE event with the document content for review:
  ```python
  # In on_complete or after stream completes:
  doc_role = _AGENT_DOC_ROLES.get(agent_id, "other")
  if doc_role in ("intake_summary", "resume_rewrite", "interview_prep"):
      yield f"data: [CONFIRM_SAVE] {json.dumps({'role': doc_role, 'content': full_response, 'conversation_id': sid})}\n\n"
  ```

**New endpoint** `POST /chat/confirm-save`:
```python
class ConfirmSaveRequest(BaseModel):
    conversation_id: str
    role: str
    content: str  # possibly edited by user
    confirmed: bool

@router.post("/chat/confirm-save")
async def confirm_save(body: ConfirmSaveRequest, auth_id=Depends(get_current_user)):
    if not body.confirmed:
        return {"status": "skipped"}
    user_id = await get_or_create_user(auth_id)
    doc_id = await db.save_document(user_id, role=body.role, filename=f"{body.role}.md", content=body.content)
    return {"status": "saved", "doc_id": doc_id}
```

**Frontend Confirmation UI**:
- When `[CONFIRM_SAVE]` event received, show a confirmation card below the response:
  ```
  ┌─────────────────────────────────────────┐
  │ 📋 Save to Memory: Intake Summary       │
  │                                          │
  │ [Editable textarea with content]         │
  │                                          │
  │ This will be used as context for future  │
  │ agent conversations.                     │
  │                                          │
  │ [Save to Memory]  [Skip]  [Edit & Save]  │
  └─────────────────────────────────────────┘
  ```
- "Save to Memory" → POST /chat/confirm-save with confirmed=true
- "Skip" → POST /chat/confirm-save with confirmed=false
- "Edit & Save" → Toggle textarea editable, then save edited content

### Verification:
- Complete Agent 1 intake → confirmation card appears with intake summary
- Click "Skip" → no document saved to DB (verify with SQL query)
- Click "Save to Memory" → document saved, Agent 2 can retrieve it
- Edit content then save → edited version is what Agent 2 sees

---

## Phase 4: Visible Validator Results

**Goal**: Make Agent 4 validation results always visible and actionable, not silently swallowed.

### Files to modify:
- `app/agents/base.py` lines 188-200 — Always emit validation, surface errors
- `app/static/index.html` — Validation result rendering

### Implementation:

**In `stream_agent()`** (base.py lines 188-200):
- Current code catches all exceptions and continues silently
- Change to ALWAYS yield a validation event:
  ```python
  if agent_id == "agent2":
      try:
          ctx = await retrieve_resume_context(user_id)
          fact_sheet = ctx.get("fact_sheet") if ctx else None
          if fact_sheet:
              validation = await validate_resume(fact_sheet, full_response)
              trace.validation_result = validation
              yield f"data: [VALIDATION] {json.dumps(validation)}\n\n"
          else:
              trace.validation_error = "No fact sheet available — validation skipped"
              yield f'data: [VALIDATION] {json.dumps({"verdict": "skipped", "reason": "No resume fact sheet found. Upload a resume first."})}\n\n'
      except Exception as e:
          trace.validation_error = str(e)
          yield f'data: [VALIDATION] {json.dumps({"verdict": "error", "reason": str(e)})}\n\n'
  ```

**Frontend Validation Rendering** (index.html):
- Current handler at ~line 1024 does nothing with validation data
- Render as a visible card below the response:
  ```
  ┌─────────────────────────────────────────┐
  │ ✅ Validation: Pass                      │  (or ⚠️ Needs Revision / ❌ Error)
  │                                          │
  │ [If flags exist, show each one:]         │
  │ • "Led team of 50+" — scope_inflation    │
  │   Suggestion: Verify team size from...   │
  │                                          │
  └─────────────────────────────────────────┘
  ```
- Color-coded: green=pass, amber=needs_revision, red=error/skipped

### Verification:
- Agent 2 response with valid resume → green validation card
- Agent 2 response with hallucinated claims → amber card with specific flags
- Agent 2 response when no resume uploaded → "skipped" card with explanation
- Agent 2 response when validator crashes → red error card (not silent)

---

## Phase Summary

| Phase | What | Files Changed | Depends On |
|-------|------|--------------|------------|
| 1 | Structured logging + trace capture | NEW `tracing.py`, `base.py`, `rag.py` | Nothing |
| 2 | Debug panel in UI | `index.html` | Phase 1 (needs [TRACE] events) |
| 3 | Memory confirmation gate | `chat.py`, `models.py`, `index.html` | Nothing (independent) |
| 4 | Visible validator results | `base.py`, `index.html` | Phase 1 (uses trace object) |

**Phases 1+3 can be done in parallel. Phase 2 depends on 1. Phase 4 depends on 1.**

---

## Anti-Pattern Guards

- **Do NOT add a separate debug API endpoint** — traces ride the existing SSE stream
- **Do NOT log full system prompts or responses to disk** — only previews (first 500 chars) to avoid PII/data concerns
- **Do NOT block the response on validation** — validation still runs async after stream, just surfaces results
- **Do NOT remove the L1 cache append from on_complete** — conversation history still needs immediate cache update; only document persistence is gated
- **Do NOT add any new Python dependencies** — stdlib `logging` and `dataclasses` are sufficient
