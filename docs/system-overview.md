# Career Coach — System Overview

## Purpose

A Dockerized multi-agent career coaching application. Users upload a resume, chat with four specialized AI agents across intake, resume rewriting, interview practice, and validation phases. All responses stream in real-time via Server-Sent Events.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | Python 3.11 | Managed by `uv` |
| Backend | FastAPI | Async, uvicorn server |
| LLM | Anthropic Claude | Sonnet for rewrites/coaching, Haiku for evaluation/edits |
| Database | PostgreSQL 16 + pgvector | Vector similarity for RAG; asyncpg connection pool |
| Auth | Clerk (external) | JWT issued by Clerk, verified server-side via middleware |
| Embeddings | Ollama `nomic-embed-text` | 768-dim vectors; graceful fallback if unavailable |
| Containerization | Docker + Docker Compose | Multi-stage build (Node → Python) |
| Frontend | Vite 6 + React 18 | Migrated from vanilla HTML/JS |
| Styling | Tailwind CSS 3 | Custom pink/gray palette matching original design |
| Dependency mgmt | `uv` (Python), `npm` (Node) | |
| File output | Host filesystem via Docker volume | `./outputs:/app/outputs` |

---

## Directory Structure

```
career-coach/
├── Dockerfile                  # Multi-stage: Node frontend build → Python app
├── docker-compose.yml          # db (pgvector) + career-coach services
├── pyproject.toml              # uv-managed Python deps
│
├── app/
│   ├── main.py                 # FastAPI entry: mounts routers + static files, serves /env.js
│   ├── config.py               # Env vars (ANTHROPIC_API_KEY, AGENT_MODELS, GENERAL_MODEL, Clerk keys)
│   ├── models.py               # Pydantic request/response schemas
│   ├── session.py              # Two-layer conversation cache: L1 in-memory, L2 PostgreSQL
│   ├── db.py                   # asyncpg pool, get_or_create_user(), retrieve_resume_context()
│   ├── rag.py                  # Resume compression, tone extraction, embedding, retrieval
│   ├── tracing.py              # Trace dataclass; per-request metrics emitted as [TRACE] SSE events
│   │
│   ├── agents/
│   │   ├── base.py             # stream_agent(): context injection (block array + cache_control), SSE streaming, validation gate
│   │   ├── agent1_intake.py    # Intake & job fit analysis
│   │   ├── agent2_resume.py    # Resume rewriting (Sonnet first, Haiku edits)
│   │   ├── agent3_interview.py # Interview prep + practice loop (Mode B)
│   │   └── agent4_validator.py # Resume fact-checking, evaluation, coaching sub-modes
│   │
│   ├── middleware/
│   │   └── auth.py             # get_current_user() FastAPI dependency; verifies Clerk JWT
│   │
│   ├── routers/
│   │   ├── chat.py             # POST /chat/{agent_id}/stream, POST /chat/confirm-save; new-conversation routing guard
│   │   ├── files.py            # GET /files/list, GET /files/{filename}
│   │   └── upload.py           # POST /upload/resume — PDF/DOCX text extraction
│   │
│   └── static/                 # Served by FastAPI StaticFiles; populated by `npm run build:app`
│
├── frontend/                   # React source (Vite project)
│   ├── src/
│   │   ├── contexts/           # AuthContext (Clerk session), ChatContext (reducer)
│   │   ├── hooks/              # useStream, useFileAttachments, useAutoResize
│   │   └── components/
│   │       ├── auth/           # AuthScreen (sign-in/sign-up tabs)
│   │       ├── layout/         # ChatLayout, ProgressPanel (ScoreRing), AgentSwitcher
│   │       ├── chat/           # ChatWindow, UserMessage, AssistantMessage, StreamingMessage
│   │       ├── cards/          # ValidationCard, ConfirmSaveCard, TracePanel
│   │       └── input/          # MessageInput, FileChip, UploadButton
│   └── package.json            # `build:app` → outputs to ../app/static
│
├── db/
│   ├── init.sql                # Schema: users, session_state, messages, documents, resume_facts
│   └── migrations/
│       ├── 001_add_auth_id.sql              # Adds auth_id (UUID) column + index to users table
│       ├── 002_conversation_panel_state.sql # Adds panel_state JSONB to conversations
│       ├── 003_add_request_traces.sql       # Adds request_traces table for LLM telemetry
│       └── 004_clerk_auth_id.sql            # Converts auth_id from UUID → TEXT for Clerk compatibility
│
├── prompts/                    # System prompt files for each agent sub-mode
└── outputs/                    # Downloaded files (Docker volume mount)
```

---

## Agent Architecture

Four agents handle distinct phases of the coaching workflow:

| Agent | Role | Model Strategy |
|---|---|---|
| Agent 1 — Intake & Fit | Collects job description, assesses resume fit, emits job_fit_score | Sonnet |
| Agent 2 — Resume Coach | Rewrites/edits resume sections | Sonnet (first rewrite) → Haiku (targeted edits) |
| Agent 3 — Interview Coach | Interview prep + interactive practice loop (Mode B) | Haiku evaluation + Sonnet coaching |
| Agent 4 — Validator | Fact-checks resume claims; three sub-modes: validation, evaluation, coaching | Haiku |

### Context Injection (RAG) + Prompt Caching

Every LLM call is augmented in `_augment_system_prompt()` (`base.py`), which returns a `list[dict]` block array (not a plain string) so individual blocks can carry `cache_control`:

| Agent | Context injected | Cache strategy |
|---|---|---|
| Agent 1 & 4 | Compressed resume fact sheet + job fit score history | No cache (static prompt ~650 tok, below 1,024-token threshold) |
| Agent 2 | Intake summary from Agent 1 + tone profile | Static prompt block cached (P2); intake summary as second cache breakpoint (P3) — ~88% input reduction after turn 1 |
| Agent 3 | Intake summary + latest resume rewrite + project context docs | Combined injected context cached (P4) — ~1,600–3,700 tok at 90% discount |

Cache hits are captured in `cache_read_input_tokens` / `cache_creation_input_tokens` on the `Trace` and persisted to `request_traces`.

Tone profiles and resume fact sheets are generated asynchronously by `rag.py` using Haiku's structured output (Pydantic schemas). Embeddings are generated via Ollama `nomic-embed-text` (768-dim) for vector similarity retrieval.

---

## Streaming & SSE Protocol

All chat responses use Server-Sent Events (`text/event-stream`). The stream carries multiple event types multiplexed in `data:` lines:

| Event | Direction | Purpose |
|---|---|---|
| `data: <chunk>` | Server → Client | Streaming text token |
| `data: [DONE]` | Server → Client | Stream complete |
| `data: [PANEL] {json}` | Server → Client | Update progress panel (job_fit_score, job_title, sections_modified) |
| `data: [VALIDATION] {json}` | Server → Client | Resume fact-check results (pass / needs-revision / skipped / error) |
| `data: [CONFIRM_SAVE] {json}` | Server → Client | Prompt user to review + save agent output to memory |
| `data: [TRACE] {json}` | Server → Client | Per-request debug metrics (model, latency, token count, context injection) |
| `data: [ERROR]` | Server → Client | Unhandled exception |

Panel updates are embedded inline in agent text using `__PANEL_UPDATE__…__END_PANEL__` delimiters, extracted by regex, stripped from the displayed message, and re-emitted as `[PANEL]` events.

---

## Authentication

| Layer | Mechanism |
|---|---|
| Auth provider | Clerk (external service) |
| Token type | JWT (Bearer token in Authorization header) |
| Server verification | `app/middleware/auth.py` verifies Clerk JWT using Clerk secret key |
| User mapping | `get_or_create_user(auth_id)` in `db.py` maps Clerk user ID → internal `user_id` on every request; `auth_id` column is TEXT (migration 004) |
| Frontend config | Clerk publishable key configured at build time via environment variable |
| Session management | React `AuthContext` uses Clerk React SDK (`@clerk/clerk-react`); JWT passed in all fetch requests |

---

## Database Schema (PostgreSQL)

| Table | Purpose |
|---|---|
| `users` | Internal user records; `auth_id` column (TEXT) links to Clerk user ID |
| `session_state` | Per-user mutable state (tone profile, current job title, etc.) |
| `messages` | Full conversation history; `metadata` JSONB stores Mode B interview session state |
| `documents` | Persisted agent outputs (intake summary, resume rewrite, interview prep, project context) |
| `conversations` | Conversation records; `job_title` column populated from Agent 1 panel updates via `update_conversation_job_title()` |
| `resume_facts` | Compressed fact sheets + pgvector embeddings for RAG retrieval |
| `request_traces` | Per-request LLM telemetry: real input/output/cache token counts, system prompt length, history depth, latency. Primary source for prompt creep detection. |

Conversation memory uses two-layer caching: **L1** in-memory dict (fast path), **L2** PostgreSQL (persistence across restarts).

---

## Observability

`app/tracing.py` implements per-request tracing:

- `Trace` dataclass collects: agent ID, model, history length, system prompt length (chars), context injection status, real token usage (input/output/cache), response stats, validation result, latency (ms)
- Token counts are real values from `stream.get_final_message().usage` (Anthropic API), not estimates — includes `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
- Emitted as `[TRACE]` SSE event after every request (success and error paths)
- **Persisted** to `request_traces` table (fire-and-forget `asyncio.create_task`) for historical querying
- **Interview sessions** (`stream_interview_session`) produce two traces per turn: `agent4_eval` (Haiku evaluation) and `agent4_coaching` (Sonnet coaching), both persisted to `request_traces`
- Frontend renders as a collapsible `TracePanel` card attached to each assistant message
- Structured logging via Python `logging` module; `logger.info/warning/error` with `%s` parameterized format

### Prompt Creep Detection

Query `request_traces` to track input token growth over time:

```sql
-- Input tokens per agent over time
SELECT agent_id, DATE(created_at) AS day,
       AVG(input_tokens)::int   AS avg_input,
       AVG(system_prompt_length) AS avg_prompt_chars,
       AVG(history_message_count) AS avg_history_depth,
       COUNT(*) AS requests
FROM request_traces
GROUP BY agent_id, day
ORDER BY agent_id, day;
```

---

## Gated Memory Saves

After Agent 1 (intake), Agent 2 (resume rewrite), and Agent 3 (interview prep) complete, the system emits a `[CONFIRM_SAVE]` SSE event. The frontend renders a `ConfirmSaveCard` with:

- Editable textarea pre-filled with agent output
- **Save to Memory** — POSTs to `/chat/confirm-save` with `confirmed: true`
- **Edit** — toggles textarea editable
- **Skip** — POSTs with `confirmed: false`, dismisses card

This gates database writes behind explicit user approval.

---

## Frontend State (React)

| Concern | Implementation |
|---|---|
| Auth session | `AuthContext` — Clerk React SDK (`useUser`, `useAuth`); JWT passed in all fetch requests |
| Chat state | `ChatContext` — `useReducer` with 7 actions: `SET_AGENT`, `PUSH_MSG`, `APPEND_CHUNK`, `FINALIZE_MSG`, `PUSH_CARD`, `APPLY_PANEL`, `SET_STREAMING` |
| SSE parsing | `useStream` hook — `fetch` + `ReadableStream`, routes all event types to reducer |
| File uploads | `useFileAttachments` hook — `consumeFiles()` one-shot pattern clears after send |
| Textarea height | `useAutoResize` hook — listens to `input` event, sets `scrollHeight` |
| Agent switch | `SET_AGENT` resets `conversationId` + clears `messages`; `clearFiles()` callback |

---

## Docker Build

Multi-stage `Dockerfile`:

1. **Stage 1 (`frontend-build`)** — `node:20-slim`: runs `npm ci && npm run build`, outputs to `/frontend/dist`
2. **Stage 2** — `python:3.11-slim`: copies Python source, copies `/frontend/dist` → `./app/static/`, installs Python deps via `uv`

Local development build: `cd frontend && npm run build:app` — outputs directly to `../app/static`.

Dev server: `npm run dev` proxies `/chat`, `/upload`, `/files`, `/env.js` to FastAPI on `:8000`.

---

## Routing Guards

`POST /chat/{agent_id}` and `POST /chat/{agent_id}/stream` enforce that new conversations must begin with Agent 1 (Intake). If `history` is empty and `agent_id != "agent1"`, the endpoint returns HTTP 400. This prevents agents such as Agent 4 (Validator) from being used as intake, which caused incorrect "Starting Your Career Transition" responses in early conversations.

---

## Environment Variables

| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API (all agent calls) |
| `DATABASE_URL` | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | Server-side JWT verification (`middleware/auth.py`) |
| `CLERK_PUBLISHABLE_KEY` | Frontend Clerk SDK init |
| `OLLAMA_BASE_URL` | Embedding service (optional; embeddings skipped if absent) |
