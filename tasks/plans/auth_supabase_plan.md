# Plan: Supabase Auth Integration + Agent 4 Verification

**Created:** 2026-04-09  
**Scope:** Backend · Database · Frontend · Docker  
**References:** `tasks/auth_task_brief.md`, `prompts/agent4_validator.md`

---

## Phase 0 — Discovery Summary (COMPLETE)

### Allowed APIs / Confirmed Facts

| Fact | Source |
|------|--------|
| SSE uses `fetch()` + `ReadableStream.getReader()`, NOT `EventSource` | `index.html:814,826` |
| No `localStorage` usage anywhere in frontend | `index.html` (0 matches) |
| `user_id` is client-supplied optional param — no auth today | `models.py:18`, `chat.py:38` |
| `POST /upload/resume` creates anonymous user, returns UUID; frontend never stores it | `upload.py:49`, `index.html:660` |
| Only 2 `fetch()` calls in frontend: `/upload/resume` (line 660) and `/chat/{agent}/stream` (line 814) | `index.html` |
| DB schema has no auth fields; `users` table PK is `user_id UUID` | `db/init.sql` |
| No migration framework — single `db/init.sql` only | filesystem |
| `agent4_validator.py` SYSTEM_PROMPT already matches `prompts/agent4_validator.md` + has panel update | `app/agents/agent4_validator.py:1-110` |
| Dependencies: `fastapi`, `asyncpg`, `anthropic`, `python-dotenv`, `pydantic`, `python-docx`, `python-multipart` | `pyproject.toml` |
| **Missing deps:** PyJWT, cryptography, supabase-js (CDN, no build step) | `pyproject.toml` (absent) |

### Key Deviation from Auth Task Brief

> The brief assumes SSE uses `EventSource` and requires token-in-query-param.  
> **Actual code uses `fetch()` with manual stream reader** (`index.html:826`).  
> Therefore: use `Authorization: Bearer` header on ALL requests including streaming — simpler and more secure.  
> No SSE query-param token needed.

### Files to Change

| File | Change Type |
|------|-------------|
| `pyproject.toml` | Add PyJWT, cryptography |
| `app/config.py` | Add SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET |
| `.env.example` | Add three Supabase vars |
| `docker-compose.yml` | Pass Supabase env vars to career-coach service |
| `db/migrations/001_add_auth_id.sql` | New — add `auth_id` column + index to `users` |
| `app/middleware/auth.py` | New — `get_current_user` FastAPI dependency |
| `app/db.py` | Add `get_or_create_user(auth_id)`, remove `create_user()` |
| `app/models.py` | Remove `user_id` from `ChatRequest` |
| `app/routers/chat.py` | Inject `get_current_user`, remove body user_id |
| `app/routers/upload.py` | Resume upload uses auth user, not anonymous creation |
| `app/routers/files.py` | Inject `get_current_user` |
| `app/static/index.html` | Add Supabase CDN, login/signup UI, wrap fetch calls |
| `app/agents/agent4_validator.py` | Verify only — no changes expected |

---

## Phase 1 — Environment & Dependencies

### Goal
Install backend deps, add env vars to all config files.

### Tasks

**1.1 — Update `pyproject.toml`**

Add to `[project] dependencies`:
```toml
"PyJWT>=2.8.0",
"cryptography>=42.0.0",
```

Verify: `grep -n "PyJWT\|cryptography" pyproject.toml` shows both lines.

**1.2 — Update `app/config.py`**

Add after existing env vars (line ~10):
```python
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")
```

Verify: `python -c "from config import SUPABASE_JWT_SECRET; print('ok')"` in container.

**1.3 — Update `.env.example`**

Append:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
```

**1.4 — Update `docker-compose.yml`**

Add to `career-coach` service `environment`:
```yaml
- SUPABASE_URL=${SUPABASE_URL}
- SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
- SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET}
```

**1.5 — Add vars to `.env`** (do NOT commit)

Add the three Supabase vars with real values obtained from Supabase dashboard:
- Project Settings → API → Project URL → `SUPABASE_URL`
- Project Settings → API → `anon public` key → `SUPABASE_ANON_KEY`
- Project Settings → API → JWT Secret → `SUPABASE_JWT_SECRET`

### Anti-patterns
- Do NOT add `SUPABASE_JWT_SECRET` to any file that gets committed
- Do NOT confuse `anon key` (public, safe) with `service_role key` (private, dangerous)

### Verification
```bash
grep "PyJWT\|cryptography" pyproject.toml      # 2 matches
grep "SUPABASE" .env.example                    # 3 matches
grep "SUPABASE" docker-compose.yml              # 3 matches
```

---

## Phase 2 — Database Migration

### Goal
Add `auth_id UUID UNIQUE` column and index to `users` table in the running Postgres container.

### Tasks

**2.1 — Create migration file**

Create `db/migrations/001_add_auth_id.sql`:
```sql
-- Migration 001: Add Supabase auth_id to users table
-- Run once against the running career_coach database

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
```

Note: `IF NOT EXISTS` guards make this safe to re-run.

**2.2 — Apply migration to running container**

```bash
docker compose exec db psql -U coach -d career_coach -f /docker-entrypoint-initdb.d/init.sql
# OR if migration file is mounted:
docker compose exec db psql -U coach -d career_coach -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE; CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);"
```

Alternative if file mount is not set up:
```bash
cat db/migrations/001_add_auth_id.sql | docker compose exec -T db psql -U coach -d career_coach
```

**2.3 — Migrate existing users**

For the 2 existing dev users:
1. Go to Supabase Dashboard → Authentication → Users → "Invite user"
2. Create accounts for both users
3. Note the Supabase `id` UUID for each
4. Run:
```sql
UPDATE users SET auth_id = '<supabase-uuid>' WHERE user_id = '<existing-uuid>';
```

### Verification
```bash
docker compose exec db psql -U coach -d career_coach -c "\d users"
# Should show auth_id column
docker compose exec db psql -U coach -d career_coach -c "SELECT user_id, auth_id FROM users LIMIT 5;"
```

---

## Phase 3 — Backend Auth Middleware

### Goal
Create `app/middleware/auth.py` with `get_current_user` FastAPI dependency. Update `app/db.py` to add `get_or_create_user`.

### Tasks

**3.1 — Create `app/middleware/auth.py`**

```python
from fastapi import Depends, HTTPException, Header
import jwt
from config import SUPABASE_JWT_SECRET

async def get_current_user(authorization: str = Header(...)) -> str:
    """
    FastAPI dependency. Verifies Supabase JWT and returns the user's auth_id (sub claim).
    Raises HTTP 401 if token is missing or invalid.
    """
    try:
        token = authorization.removeprefix("Bearer ")
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated"
        )
        return payload["sub"]  # Supabase user UUID (auth_id)
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

**3.2 — Add `get_or_create_user` to `app/db.py`**

Add after the existing `create_user` function (around line 47). Keep `create_user` for now — it will be removed in Phase 4 once all callers are migrated.

```python
async def get_or_create_user(auth_id: str) -> str:
    """
    Given a Supabase auth_id (UUID string), look up or create the internal user row.
    Returns the internal users.user_id as a string.
    """
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id FROM users WHERE auth_id = $1", auth_id
        )
        if row:
            return str(row["user_id"])
        user_id = uuid.uuid4()
        await conn.execute(
            "INSERT INTO users (user_id, auth_id) VALUES ($1, $2)",
            user_id, auth_id
        )
        await conn.execute(
            "INSERT INTO session_state (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
            user_id
        )
        return str(user_id)
```

Note: Check `db/init.sql` for exact column name — it's `user_id` not `id` per the schema.

### Verification
```bash
# Syntax check
docker compose exec career-coach python -c "from middleware.auth import get_current_user; print('ok')"
docker compose exec career-coach python -c "from db import get_or_create_user; print('ok')"
```

---

## Phase 4 — Update Backend Routes

### Goal
Wire `get_current_user` into all routes. Remove `user_id` from request bodies. Update upload flow.

### Tasks

**4.1 — Update `app/models.py`**

Remove `user_id` field from `ChatRequest` (line 18). The new `ChatRequest`:
```python
class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    # user_id removed — comes from JWT via get_current_user dependency
```

**4.2 — Update `app/routers/chat.py`**

Add import at top:
```python
from middleware.auth import get_current_user
from app import db as db_module
```

Update both endpoints to inject auth and resolve internal user_id:

```python
@router.post("/chat/{agent_id}")
async def chat(agent_id: int, body: ChatRequest, auth_id: str = Depends(get_current_user)):
    user_id = await db_module.get_or_create_user(auth_id)
    # rest unchanged, replace body.user_id with user_id
```

```python
@router.post("/chat/{agent_id}/stream")
async def chat_stream(agent_id: int, body: ChatRequest, auth_id: str = Depends(get_current_user)):
    user_id = await db_module.get_or_create_user(auth_id)
    # rest unchanged, replace body.user_id with user_id
```

All references to `body.user_id` in chat.py (lines 38, 42, 60, 67, 71, 81) become `user_id`.

**4.3 — Update `app/routers/upload.py`**

Add imports:
```python
from middleware.auth import get_current_user
from app import db as db_module
```

Update `POST /upload/resume` (line 41):
```python
@router.post("/upload/resume")
async def upload_resume(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    auth_id: str = Depends(get_current_user)
):
    user_id = await db_module.get_or_create_user(auth_id)
    # remove: user_id = await db.create_user()
    # rest unchanged
```

Update `POST /upload/document` (line 70):
```python
@router.post("/upload/document")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    role: str = Form(...),
    # REMOVE: user_id: str = Form(...)  -- was client-controlled, security gap
    auth_id: str = Depends(get_current_user)
):
    user_id = await db_module.get_or_create_user(auth_id)
    # rest unchanged
```

**4.4 — Update `app/routers/files.py`**

```python
from middleware.auth import get_current_user

@router.post("/files/save")
async def save_file(body: SaveFileRequest, auth_id: str = Depends(get_current_user)):
    # existing logic unchanged (no user scoping needed for filesystem files yet)

@router.get("/files/list")
async def list_files(auth_id: str = Depends(get_current_user)):
    # existing logic unchanged
```

**4.5 — Remove anonymous `create_user` call path**

After completing 4.3, delete `create_user()` from `app/db.py` if it has no other callers:
```bash
grep -rn "create_user" app/  # should show 0 results after migration
```

### Anti-patterns
- Do NOT read `user_id` from request body, query params, or form data in any auth-protected route
- Do NOT pass `auth_id` directly to DB queries — always resolve to internal `user_id` first via `get_or_create_user`

### Verification
```bash
grep -rn "body\.user_id\|form.*user_id\|query.*user_id" app/routers/   # should be 0
grep -rn "get_current_user" app/routers/                                 # should appear in all 3 routers
```

---

## Phase 5 — Frontend Auth UI

### Goal
Add Supabase-js CDN, login/signup form, session management, and wrap all fetch calls with Authorization header.

### Key Decision (from Phase 0)
SSE uses `fetch()` + `ReadableStream.getReader()` (NOT `EventSource`). Both fetch calls get the `Authorization: Bearer` header. No query-param token needed.

### Tasks

**5.1 — Add Supabase CDN to `index.html`**

In `<head>` section, add before closing `</head>`:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

**5.2 — Add Auth UI HTML**

Add a login/signup overlay div before the main app container. It renders on top when no session exists, and is hidden once logged in:

```html
<!-- Auth Screen — shown when no session -->
<div id="auth-screen" style="display:none; position:fixed; inset:0; background:#0f0f0f; z-index:1000; display:flex; align-items:center; justify-content:center;">
  <div style="background:#1a1a1a; padding:2rem; border-radius:8px; width:360px;">
    <h2 style="color:#fff; margin-bottom:1.5rem;">Career Coach</h2>
    <input id="auth-email" type="email" placeholder="Email" style="width:100%; margin-bottom:0.75rem; padding:0.5rem; background:#2a2a2a; border:1px solid #333; color:#fff; border-radius:4px;">
    <input id="auth-password" type="password" placeholder="Password" style="width:100%; margin-bottom:1rem; padding:0.5rem; background:#2a2a2a; border:1px solid #333; color:#fff; border-radius:4px;">
    <div id="auth-error" style="color:#ff6b6b; margin-bottom:0.75rem; font-size:0.85rem; display:none;"></div>
    <button onclick="signIn()" style="width:100%; padding:0.6rem; background:#2563eb; color:#fff; border:none; border-radius:4px; cursor:pointer; margin-bottom:0.5rem;">Sign In</button>
    <button onclick="signUp()" style="width:100%; padding:0.6rem; background:#1a1a1a; color:#aaa; border:1px solid #333; border-radius:4px; cursor:pointer;">Create Account</button>
  </div>
</div>
```

Add a sign-out button in the existing UI header area (find the top bar in current HTML).

**5.3 — Add Supabase initialization and auth JS**

In the `<script>` section, at the top (after variable declarations, before event listeners):

```javascript
// Supabase client — anon key is safe to expose client-side
const SUPABASE_URL = 'https://your-project.supabase.co'   // replace with real value
const SUPABASE_ANON_KEY = 'your-anon-key'                  // replace with real value
const supabase = window.Supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let currentSession = null  // holds the active Supabase session

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex'
}

function hideAuthScreen() {
  document.getElementById('auth-screen').style.display = 'none'
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error')
  el.textContent = msg
  el.style.display = 'block'
}

async function signIn() {
  const email = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) { showAuthError(error.message); return }
  initApp(data.session)
}

async function signUp() {
  const email = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) { showAuthError(error.message); return }
  initApp(data.session)
}

async function signOut() {
  await supabase.auth.signOut()
  currentSession = null
  showAuthScreen()
}

function initApp(session) {
  currentSession = session
  hideAuthScreen()
}

// On page load — check for existing session
;(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) initApp(session)
  else showAuthScreen()
})()

// Listen for token refresh / sign out
supabase.auth.onAuthStateChange((event, session) => {
  if (session) initApp(session)
  else { currentSession = null; showAuthScreen() }
})
```

**5.4 — Wrap fetch calls with Authorization header**

Replace the two existing `fetch()` calls:

**Upload resume (line 660):**
```javascript
// Before:
const resp = await fetch('/upload/resume', { method: 'POST', body: form })

// After:
const resp = await fetch('/upload/resume', {
  method: 'POST',
  body: form,
  headers: { 'Authorization': `Bearer ${currentSession.access_token}` }
})
```

**Chat stream (line 814):**
```javascript
// Before:
const resp = await fetch(`/chat/${activeAgent}/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationId, message: fullMessage })
})

// After:
const resp = await fetch(`/chat/${activeAgent}/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${currentSession.access_token}`
  },
  body: JSON.stringify({ conversation_id: conversationId, message: fullMessage })
})
```

**5.5 — Guard fetch calls**

Both fetch calls should check `currentSession` before firing:
```javascript
if (!currentSession) { showAuthScreen(); return }
```

Add this check at the start of the upload handler and the send message handler.

### Anti-patterns
- Do NOT use `window.supabase.createClient` — the CDN exports `window.Supabase` (capital S) with `@supabase/supabase-js@2`
- Do NOT hardcode JWT secret anywhere in the frontend
- Do NOT manually manage tokens in localStorage — supabase-js handles this internally

### Verification
```bash
# Manual browser test:
# 1. Load app — login screen should appear
# 2. Sign in with test credentials
# 3. Upload a resume — should succeed (check network tab for 200)
# 4. Send a chat message — should get a response (check network tab for Authorization header)
# 5. Refresh page — should stay logged in (supabase-js uses localStorage internally)
# 6. Sign out — login screen should reappear
```

---

## Phase 6 — Docker Rebuild & Smoke Test

### Goal
Rebuild the Docker image with new dependencies, restart containers, run end-to-end test.

### Tasks

**6.1 — Rebuild image**
```bash
docker compose build career-coach
docker compose up -d
docker compose logs career-coach --tail 30  # check for startup errors
```

**6.2 — Verify PyJWT loaded**
```bash
docker compose exec career-coach python -c "import jwt; print(jwt.__version__)"
```

**6.3 — Verify new env vars are present**
```bash
docker compose exec career-coach python -c "from config import SUPABASE_JWT_SECRET; print('secret loaded:', bool(SUPABASE_JWT_SECRET))"
```

**6.4 — Smoke test unauthenticated request (should 401)**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/chat/1 \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
# Expected: 422 (missing Authorization header) or 401
```

**6.5 — Database migration applied**
```bash
docker compose exec db psql -U coach -d career_coach -c "\d users" | grep auth_id
# Expected: auth_id | uuid | nullable
```

**6.6 — Full auth flow**
1. Open `http://localhost:8000` in browser
2. Login screen appears
3. Sign in with test Supabase credentials
4. Upload resume — check network tab: `Authorization: Bearer ...` present, response 200
5. Switch to Agent 1, send message — check network tab: `Authorization: Bearer ...` present, streaming response
6. Check DB: `SELECT * FROM users WHERE auth_id IS NOT NULL;` — should show user row

---

## Phase 7 — Agent 4 Prompt Files

### Goal
Create the three new prompt files required by the task brief. These replace the legacy "truth auditor" SYSTEM_PROMPT for the two operational modes.

### Context
`agent4_validator.py` currently holds a single SYSTEM_PROMPT (the original truth-audit narrative agent). The task brief refactors Agent 4 into **Mode A** (Haiku structured JSON, runs automatically after Agent 2) and **Mode B** (interview coaching loop, runs after Agent 3 on user intent). The old SYSTEM_PROMPT is retired from the primary flow.

### Tasks

**7.1 — Create `prompts/agent4_resume_validation.txt`** (Mode A — Haiku)

This is a structured-output-only prompt. Behavioral requirements per brief:
- Compare only against the provided fact sheet — do not invent source material
- Flag conservatively; a reasonable interpretation should pass
- Output JSON only, no prose

```
You are a resume validation engine. You receive a resume rewrite and a fact sheet of confirmed source material.

Your only job is to identify claims in the rewrite that outpace the evidence in the fact sheet. Output JSON only — no prose, no preamble, no explanation.

Flag categories:
- unsupported_quantification: a number or percentage appears in the rewrite with no basis in the fact sheet
- scope_inflation: ownership language ("led", "owned", "built") where the fact sheet says contribution language
- orphaned_skill: a skill is listed with no supporting project or role in the source material

Flag conservatively. If a claim has a reasonable basis in the fact sheet, do not flag it.

Output format (strict JSON):
{
  "verdict": "pass | needs_revision",
  "flags": [
    {
      "claim": "exact phrase from the rewrite",
      "issue": "unsupported_quantification | scope_inflation | orphaned_skill",
      "suggestion": "specific, actionable fix"
    }
  ]
}

FACT SHEET:
{fact_sheet}

RESUME REWRITE:
{resume_rewrite}
```

Note: `{fact_sheet}` and `{resume_rewrite}` are filled in by the backend before calling — not Anthropic template syntax.

**7.2 — Create `prompts/agent4_interview_evaluation.txt`** (Mode B evaluation — Haiku)

Scoring rubric per task brief:

```
You are an interview answer evaluator. Score the user's answer to the given interview question using the rubric below. Output JSON only — no prose.

Scoring rubric:
- 90–100: Specific, backed by evidence from the resume, and complete
- 70–89: Mostly good but missing one specific detail or quantifier
- 50–69: On topic but vague — no evidence cited
- < 50: Off topic, generic, or contradicts the resume

Output format (strict JSON):
{
  "score": <integer 0-100>,
  "gaps": ["specific missing element"],
  "follow_up": "<single clarifying question, or null if score >= 90>"
}

RESUME FACT SHEET:
{fact_sheet}

INTERVIEW QUESTION:
{question}

USER'S ANSWER:
{answer}
```

**7.3 — Create `prompts/agent4_interview_coaching.txt`** (Mode B coaching — Sonnet)

Behavioral requirements per task brief:
- On pass: acknowledge what worked in one sentence, move to next question without announcing the score
- On follow-up: feedback in 1-2 sentences, ask exactly one follow-up question, do not restate the answer
- Transition like a real interviewer — not a grading rubric
- Do not use "great answer" or "excellent" — be specific

```
You are an interview coach running a live practice session. You receive a structured evaluation of the user's last answer and the full conversation history for this question.

Rules:
- Do not announce the score aloud — scores surface via __PANEL_UPDATE__ only
- Do not restate the user's answer back to them
- Do not use "great answer", "excellent", or generic praise — be specific about what worked
- Transition language should feel like a real interviewer, not a grading rubric

If score >= 90:
- Acknowledge one specific thing that worked (one sentence)
- Move naturally to the next question: ask it directly

If score < 90:
- Deliver targeted feedback in 1–2 sentences (what was missing, not a summary of what they said)
- Ask exactly one follow-up question

After the final question, deliver a short debrief:
- Average score across all questions (prose — no JSON)
- One or two questions to revisit before the interview
- One concrete thing the user did well

At the end of every response, append:
__PANEL_UPDATE__
{"job_fit_score": <score from evaluation JSON, or null>, "job_title": null, "last_action": "<e.g. 'Question 3 of 10' or 'Follow-up: Q2' or 'Session complete'>", "sections_modified": null}
__END_PANEL__

EVALUATION RESULT:
{evaluation_json}
```

### Verification
```bash
ls prompts/agent4_*.txt   # should show all 3 files
wc -l prompts/agent4_resume_validation.txt prompts/agent4_interview_evaluation.txt prompts/agent4_interview_coaching.txt
```

---

## Phase 8 — Agent 4 Mode A: Resume Validation Gate

### Goal
Wire Mode A into the Agent 2 `on_complete` callback in `base.py`. After Agent 2 finishes streaming, call Haiku with the resume rewrite and fact sheet, and surface any flags as a `[VALIDATION]` SSE event.

### Tasks

**8.1 — Add `validate_resume` function to `app/agents/agent4_validator.py`**

Replace the file's content. Keep SYSTEM_PROMPT for backward compatibility (legacy manual check path), add Mode A below it:

```python
import json
from typing import Optional
import anthropic
from config import ANTHROPIC_API_KEY, AGENT_MODELS

_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# Retained for legacy manual-check UI path (agent_id=4 conversation)
SYSTEM_PROMPT = """..."""  # keep existing content unchanged

async def validate_resume(fact_sheet: dict, resume_rewrite: str) -> dict:
    """
    Mode A: Haiku structured call. Returns parsed JSON dict with verdict and flags.
    Called by base.py after Agent 2 stream completes.
    """
    from pathlib import Path
    prompt_template = Path("prompts/agent4_resume_validation.txt").read_text()
    prompt = prompt_template.replace("{fact_sheet}", json.dumps(fact_sheet, indent=2))
    prompt = prompt.replace("{resume_rewrite}", resume_rewrite)

    model = AGENT_MODELS["agent4_validation"]["model"]  # Haiku — add to config.py
    response = _client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = response.content[0].text.strip()
    return json.loads(raw)
```

**8.2 — Add `agent4_validation` to `AGENT_MODELS` in `app/config.py`**

```python
AGENT_MODELS = {
    ...
    "agent4_validation": {"model": "claude-haiku-4-5-20251001", "mode": "single"},
    "agent4_eval": {"model": "claude-haiku-4-5-20251001", "mode": "single"},
    "agent4_coaching": {"model": "claude-sonnet-4-6", "mode": "single"},
}
```

**8.3 — Wire Mode A into `stream_agent` in `app/agents/base.py`**

In the `stream_agent` function, after `on_complete(full_response)` is called and only when `agent_id == "agent2"`:

```python
# After existing on_complete call (line ~186):
if agent_id == "agent2" and user_id:
    from agents.agent4_validator import validate_resume
    from app import db
    context = await db.retrieve_resume_context(user_id)
    if context and context.get("fact_sheet"):
        try:
            validation = await validate_resume(context["fact_sheet"], full_response)
            if validation.get("flags"):
                safe_val = json.dumps(validation).replace("\n", "\\n")
                yield f"data: [VALIDATION] {safe_val}\n\n"
        except Exception:
            pass  # validation failure is non-blocking
```

Note: `stream_agent` is an async generator — `yield` inside the try/except block after the stream loop is valid here.

**8.4 — Handle `[VALIDATION]` events in `index.html`**

In the SSE stream reader (line ~826), add a handler alongside `[PANEL]` and `[DONE]`:

```javascript
if (line.startsWith('data: [VALIDATION] ')) {
  try {
    const validation = JSON.parse(line.slice('data: [VALIDATION] '.length))
    renderValidationFlags(validation)
  } catch(e) {}
  continue
}
```

Add `renderValidationFlags(validation)` function:

```javascript
function renderValidationFlags(validation) {
  if (!validation.flags || validation.flags.length === 0) return
  const container = document.getElementById('messages')
  const callout = document.createElement('div')
  callout.className = 'validation-callout'
  callout.innerHTML = `
    <div class="validation-header">Resume Validation — ${validation.flags.length} flag(s)</div>
    ${validation.flags.map(f => `
      <div class="validation-flag">
        <span class="flag-claim">"${f.claim}"</span>
        <span class="flag-issue">${f.issue.replace(/_/g, ' ')}</span>
        <span class="flag-suggestion">${f.suggestion}</span>
      </div>
    `).join('')}
  `
  container.appendChild(callout)
  container.scrollTop = container.scrollHeight
}
```

Add corresponding CSS for `.validation-callout`, `.validation-header`, `.validation-flag`, `.flag-claim`, `.flag-issue`, `.flag-suggestion` — use amber/yellow color scheme to distinguish from normal messages.

### Anti-patterns
- Mode A MUST be non-blocking — validation failure (JSON parse error, API timeout) must not prevent the resume from being shown to the user
- Do NOT use `stream_agent` for Mode A — it is a single structured call via `_client.messages.create` (sync Anthropic client is fine here since it's inside the async generator's try block, but prefer `_async_client.messages.create` to avoid blocking)

### Verification
```bash
# After Agent 2 completes a rewrite, check logs for:
docker compose logs career-coach | grep "agent4_validation\|VALIDATION"
# In browser: if flags exist, callout block appears below the rewrite
# If verdict=pass: no callout rendered (flags array empty)
```

---

## Phase 9 — Agent 4 Mode B: Interview Coaching Loop

### Goal
Implement the two-call-per-question coaching loop. Trigger from Agent 3 on practice intent. Track session state in `messages.metadata`.

### Architecture (from task brief)

```
User in Agent 3 sends "let's go" / "run me through them"
  → backend detects intent keyword in user message
  → switches routing to Agent 4 Mode B for this conversation
  → Mode B: reads Agent 3's question list from conversation history
  → For each question:
      Ask question N (Sonnet coaching call)
      User answers
      Call 1: Haiku eval → { score, gaps, follow_up }
      Call 2: Sonnet coaching → user-facing response + __PANEL_UPDATE__
      Persist metadata to messages table
  → After final question: Sonnet session summary
```

### Tasks

**9.1 — Add `interview_practice` mode detection in `app/routers/chat.py`**

In the Agent 3 stream handler, before calling `stream_agent`, check for practice intent:

```python
PRACTICE_INTENT_PHRASES = [
    "let's go", "lets go", "run me through", "start the practice",
    "i'm ready", "im ready", "begin", "start practicing", "go ahead"
]

def _is_practice_intent(message: str) -> bool:
    msg_lower = message.lower()
    return any(phrase in msg_lower for phrase in PRACTICE_INTENT_PHRASES)
```

If `agent_id == 3` and `_is_practice_intent(body.message)`, route to `stream_interview_session` instead of `stream_agent`.

**9.2 — Add `stream_interview_session` to `app/agents/base.py`**

New async generator function:

```python
async def stream_interview_session(
    history: list,
    user_message: str,
    user_id: str,
    conversation_id: str,
):
    """
    Mode B interview coaching loop.
    Reads session state from the last assistant message metadata.
    Runs Haiku eval → Sonnet coaching for each answer.
    """
    from app import db
    from pathlib import Path

    eval_prompt_template = Path("prompts/agent4_interview_evaluation.txt").read_text()
    coaching_prompt_template = Path("prompts/agent4_interview_coaching.txt").read_text()

    # Load session state from last message metadata
    # (or initialize on first call)
    session_meta = _load_interview_session(history)
    questions = session_meta.get("questions", [])
    q_idx = session_meta.get("question_index", 0)
    scores = session_meta.get("scores", [])
    follow_up_count = session_meta.get("follow_up_count", 0)

    # Build and run Haiku evaluation
    fact_sheet = {}
    context = await db.retrieve_resume_context(user_id)
    if context:
        fact_sheet = context.get("fact_sheet", {})

    current_question = questions[q_idx] if q_idx < len(questions) else None

    eval_prompt = (eval_prompt_template
        .replace("{fact_sheet}", json.dumps(fact_sheet, indent=2))
        .replace("{question}", current_question or "")
        .replace("{answer}", user_message))

    eval_response = _client.messages.create(
        model=AGENT_MODELS["agent4_eval"]["model"],
        max_tokens=512,
        messages=[{"role": "user", "content": eval_prompt}]
    )
    evaluation = json.loads(eval_response.content[0].text.strip())
    score = evaluation.get("score", 0)

    # Update session state
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

    # Run Sonnet coaching call (streaming)
    coaching_prompt = coaching_prompt_template.replace(
        "{evaluation_json}", json.dumps(evaluation, indent=2)
    )

    full_response = ""
    async with _async_client.messages.stream(
        model=AGENT_MODELS["agent4_coaching"]["model"],
        max_tokens=2048,
        system=coaching_prompt,
        messages=_build_messages(history, user_message),
    ) as stream:
        async for text in stream.text_stream:
            full_response += text
            yield f"data: {text.replace(chr(10), chr(92)+'n')}\n\n"

    # Extract PANEL_UPDATE, persist metadata
    panel_json = None
    m = _PANEL_RE.search(full_response)
    if m:
        try:
            panel_json = json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
        full_response = _PANEL_RE.sub("", full_response).rstrip()

    # Save message with session metadata
    await db.append_message(conversation_id, "assistant", full_response, agent_id=4, metadata=new_meta)

    if panel_json is not None:
        yield f"data: [PANEL] {json.dumps(panel_json).replace(chr(10), chr(92)+'n')}\n\n"

    yield "data: [DONE]\n\n"
```

**9.3 — Add `_load_interview_session` helper to `base.py`**

Reads the last assistant message's metadata to restore session state:

```python
def _load_interview_session(history: list) -> dict:
    """Find the most recent assistant message with interview_practice metadata."""
    for msg in reversed(history):
        if msg.get("role") == "assistant":
            meta = msg.get("metadata") or {}
            if meta.get("mode") == "interview_practice":
                return meta
    return {}
```

Note: The `history` list format needs to include metadata. Check if `db.load_conversation_history` returns metadata — if not, update that query in `app/db.py` to include the `metadata` column.

**9.4 — Session initialization (first call)**

On first practice intent trigger, Agent 3's question list must be extracted from the last Agent 3 assistant message in history. Add a helper:

```python
def _extract_questions_from_history(history: list) -> list[str]:
    """
    Parse Agent 3's question list from conversation history.
    Look for lines starting with '**Question:**' in the last agent3 message.
    """
    for msg in reversed(history):
        if msg.get("role") == "assistant" and msg.get("agent_id") == 3:
            lines = msg["content"].split("\n")
            return [
                line.replace("**Question:**", "").strip()
                for line in lines if line.strip().startswith("**Question:**")
            ]
    return []
```

Initialize `session_meta["questions"]` from this on first call (when `_load_interview_session` returns empty dict).

**9.5 — Update `db.load_conversation_history` to include metadata**

Check `app/db.py` line ~228. The SELECT query must include the `metadata` column and return it in the dict. If it's missing, add it:

```python
# In load_conversation_history, ensure SELECT includes metadata:
rows = await conn.fetch(
    "SELECT role, content, agent_id, metadata FROM messages "
    "WHERE conversation_id = $1 ORDER BY created_at",
    uuid.UUID(conversation_id)
)
return [{"role": r["role"], "content": r["content"],
         "agent_id": r["agent_id"], "metadata": dict(r["metadata"] or {})}
        for r in rows]
```

### Anti-patterns
- Do NOT stall the session if `follow_up_count >= 2` — per brief: "transition anyway, leave a brief coaching note"
- Do NOT announce the score in the coaching response — score surfaces via `__PANEL_UPDATE__` only
- Two follow-up attempts maximum per question — enforce via `follow_up_count >= 2` check

### Verification
```bash
# Manual test:
# 1. Run Agent 3 to generate questions
# 2. Send "let's go" — first question should appear
# 3. Answer it — coaching response appears, panel updates with score
# 4. Answer a second question poorly (vague response) — follow-up question should appear
# 5. Answer follow-up — transitions to next question regardless of score
# 6. Check DB: SELECT metadata FROM messages WHERE agent_id=4 ORDER BY created_at DESC LIMIT 1;
#    Should show question_index, scores, session_complete fields
```

---

## Phase 10 — Docker Rebuild (Agent 4 + Auth)

### Goal
Rebuild and smoke-test the full system with both auth and Agent 4 changes.

### Tasks

**10.1 — Rebuild image**
```bash
docker compose build career-coach
docker compose up -d
docker compose logs career-coach --tail 50
```

**10.2 — Verify all imports resolve**
```bash
docker compose exec career-coach python -c "
from agents.agent4_validator import validate_resume, SYSTEM_PROMPT
from middleware.auth import get_current_user
import jwt
print('all imports ok')
"
```

**10.3 — Smoke test Mode A**
1. Sign in via browser
2. Upload resume
3. Switch to Agent 2, send message asking for resume rewrite
4. After Agent 2 responds: check browser for validation callout (if flags) or clean response (if verdict=pass)
5. Check docker logs for: `agent4_validation` model call

**10.4 — Smoke test Mode B**
1. Switch to Agent 3, request interview questions
2. Send "let's go" — first question should appear
3. Answer it — coaching response with `__PANEL_UPDATE__` containing score

**10.5 — Smoke test auth 401**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8000/chat/1 \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
# Expected: 422 or 401
```

---

## Phase 11 — Security Checklist

Run before marking complete:

- [ ] `SUPABASE_JWT_SECRET` is NOT in any committed file (`git grep SUPABASE_JWT_SECRET`)
- [ ] `user_id` is not accepted from request body in any route (`grep -rn "body\.user_id" app/routers/`)
- [ ] All endpoints require auth (`grep -rn "Depends(get_current_user)" app/routers/` — should appear in chat.py, upload.py, files.py)
- [ ] Token logged nowhere (`grep -rn "access_token\|Bearer" app/` — should only appear in middleware/auth.py)
- [ ] Existing users have `auth_id` set (run SQL check in Phase 2.3)
- [ ] Refresh works (sign in, close tab, reopen — still logged in)
- [ ] Mode A validation is non-blocking (comment exception handler in Phase 8.3)
- [ ] Interview session does not stall on low-scoring answers (follow_up_count >= 2 guard)

---

## Execution Order

```
Auth track:
  Phase 1 (env/deps) → Phase 2 (DB migration) → Phase 3 (middleware) → Phase 4 (routes) → Phase 5 (frontend)

Agent 4 track (parallel-safe with auth track):
  Phase 7 (prompt files) → Phase 8 (Mode A gate) → Phase 9 (Mode B loop)

Converge:
  Phase 10 (rebuild + smoke test) → Phase 11 (security checklist)
```

Auth track and Agent 4 track are independent — they can be developed in separate sessions simultaneously. Phase 10 requires both tracks complete.

**Session 1 (backend):** Phases 1 + 2 + 3 + 4  
**Session 2 (frontend):** Phase 5  
**Session 3 (Agent 4):** Phases 7 + 8 + 9  
**Session 4 (integration):** Phases 10 + 11

---

## Supabase Project Setup Reminder

Before executing Phase 1, you need:
1. Create project at supabase.com
2. Authentication → Providers → Enable Email
3. Authentication → Email → Disable "Confirm email" (dev only)
4. Settings → API → copy URL, anon key, JWT secret
5. Create test accounts: Authentication → Users → Invite user (one per dev user)
