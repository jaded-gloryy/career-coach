Task Breakdown — Career Coach System (Phase 2)
These break into 5 sections ordered by dependency. Sections 1–3 are independent and can be parallelized. Section 4 depends on 1. Section 5 depends on 4.

Section 1 — Model Infrastructure: Anthropic API + Agent Routing
What it is: Swap the inference layer to Anthropic, configure per-agent model selection, and add the Haiku/Sonnet split for Agent 2.
Tasks:

Replace current inference client with anthropic SDK (or keep OpenAI-compatible client pointed at Anthropic's base URL)
Add ANTHROPIC_API_KEY to Docker env and .env
Define agent-to-model routing config:

pythonAGENT_MODELS = {
    "intake":      {"model": "claude-sonnet-4-6", "mode": "single"},
    "resume":      {"main": "claude-sonnet-4-6", "targeted": "claude-haiku-4-5"},
    "interviewer": {"model": "claude-sonnet-4-6", "mode": "single"},
    "validator":   {"model": "claude-sonnet-4-6", "mode": "single"},
}

Add logic to Agent 2 to detect whether it's doing a main rewrite (Sonnet) vs a targeted edit — bullet rewrite, exec summary, skills section — (Haiku). Trigger heuristic: first generation after upload = Sonnet; subsequent single-section requests = Haiku.
Eval gate: assert correct model is called per agent and per interaction type via log inspection

Depends on: Nothing. Start here in parallel with Section 2 and 3.

Section 2 — Multi-File Upload
What it is: Allow the user to upload multiple documents at once (e.g. resume + job description + writing sample).
Tasks:

Update the file input element to accept multiple
Update the backend endpoint to accept a list of files
Define file role tagging — each uploaded file gets a role label:

resume       → primary document for Agent 2
job_posting  → context for Agent 2 and 3
writing_sample → stored for tone modeling (see Section 5)
other        → passed as supplementary context

Display uploaded files as a dismissible chip list in the UI (filename + role badge)
Pass the full file set as context to the active agent on each turn
Handle mixed types: PDF + DOCX + TXT

Depends on: Nothing. Parallel with Section 1 and 3.

Section 3 — Progress UI Panel
What it is: A persistent panel above the chat showing Job fit score, active agent, and job context summary.
Tasks:

Add a ProgressPanel component above the chat area with three regions:

┌─────────────────────────────────────────────────────┐
│  Active Agent: Resume Coach    Job Title: [inferred] │
├──────────────────┬──────────────────────────────────┤
│  Job fit Score       │  Session Summary                 │
│  ████░░░░  62    │  3 sections revised               │
│  [score bar]     │  Last action: bullet rewrite      │
└──────────────────┴──────────────────────────────────┘

Job fit Score: numeric 0–100, rendered as a color-coded circular progress bar (red < 50, yellow 50–74, green ≥ 75). Score is returned as a structured field in Agent 1 (intake fit) and Validator responses — not inferred from prose.
Job Title: extracted by the Intake agent and stored in session state. Displayed as-is; falls back to "Not yet determined."
Active Agent: updates as the user switches agents
Session Summary: last action taken + count of sections modified this session

Schema for agent responses that feed the panel:
pythonclass AgentPanelUpdate(BaseModel):
    job_fit_score: Optional[int] = None        # 0-100, only from Agent 1 + 4
    job_title: Optional[str] = None        # only from Agent 1
    last_action: Optional[str] = None      # short label, all agents
    sections_modified: Optional[int] = None

Panel state is frontend session state — does not need to persist across browser refresh for now
Validator agent (Agent 4) also returns an job_fit_score — this is the authoritative score; Agent 1's score is a working estimate

Depends on: Nothing in terms of infra. The job_fit_score field in agent responses requires Section 1 to be complete first for accurate values.

Section 4 — PostgreSQL + Per-User Storage + Docker
What it is: Add Postgres to the Docker stack, define the user and document schema, and wire up per-session user creation on resume upload.
Tasks:
Docker:

Add postgres:16-alpine service to docker-compose.yml
Add pgvector extension (needed for Section 5)
Add DATABASE_URL env var to the app service
Add a db/init.sql run-once schema migration

Schema:
sql-- New user created on each resume upload (for now)
CREATE TABLE users (
    user_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ DEFAULT now(),
    tone_sample TEXT          -- raw writing sample, stored plaintext
);

CREATE TABLE documents (
    doc_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(user_id),
    role        TEXT NOT NULL,  -- resume | job_posting | writing_sample | other
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,  -- extracted plaintext
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resume_snapshots (
    snapshot_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(user_id),
    version      INT NOT NULL,
    content      TEXT NOT NULL,
    job_fit_score    INT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE session_state (
    user_id      UUID PRIMARY KEY REFERENCES users(user_id),
    job_title    TEXT,
    active_agent TEXT,
    sections_modified INT DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT now()
);

On resume upload: create new users row, insert documents row, create initial resume_snapshots entry at version 1
session_state row created alongside the user record
Expose user_id to the frontend (store in localStorage or session cookie) so subsequent requests are attributed to the correct user
Add a db/ module with get_conn(), create_user(), save_document(), save_snapshot(), load_user_context()

Depends on: Section 2 (multi-upload) — upload handler triggers user creation.

Section 5 — RAG + Tone Memory
What it is: Compress resume context into embeddings stored in pgvector. Wire Intake and Validator agents to retrieve this context per user. Extract and store user tone from writing sample.
Tasks:
Tone modeling:

When a writing sample is uploaded (role = writing_sample), extract tone descriptors using a lightweight Haiku call:

pythonTONE_EXTRACTION_PROMPT = """
Analyze this writing sample and extract 5-8 tone descriptors.
Return only JSON: {"tone": ["descriptor1", ...], "style_notes": "2 sentences"}
"""

Store the raw sample in users.tone_sample and the structured descriptors in session_state (add a tone_descriptors JSONB column)
Agent 2's system prompt injects tone descriptors: "Balance the following tone characteristics with professional clarity: {tone_descriptors}"

RAG — resume compression:

After each resume_snapshots save, generate a compressed embedding of the resume content
Add to schema:

sqlCREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE resume_snapshots 
ADD COLUMN embedding vector(1536);  -- adjust dim to match your embedding model

Use a local embedding model via Ollama (nomic-embed-text) or Anthropic's embeddings endpoint
Compression step: before embedding, summarize the resume into a structured JSON fact sheet (skills, roles, years of experience, education, key achievements) — embed the fact sheet, not the raw resume. This reduces noise and token cost on retrieval.

pythonclass ResumeFactSheet(BaseModel):
    job_titles: list[str]
    skills: list[str]
    years_experience: int
    education: list[str]
    key_achievements: list[str]
    job_fit_score: Optional[int]
    version: int

Retrieval: Intake and Validator agents call retrieve_resume_context(user_id) before generating their response. This returns the most recent fact sheet + job fit score history, injected into their system prompt.
Retrieval is by user_id exact match for now (not semantic search across users) — pgvector is being used for future-proofing and cross-version similarity, not cross-user lookup yet.

Depends on: Section 4 (Postgres must be running, schema must exist).

Execution Order
Week 1 (parallel):
  → Section 1: Anthropic API + model routing
  → Section 2: Multi-file upload
  → Section 3: Progress UI panel (static/mock data first)

Week 2:
  → Section 4: Postgres + Docker + user schema
    (unblocked once Section 2 lands)

Week 3:
  → Section 5: RAG + tone memory
    (requires Section 4)
  → Section 3 final wire-up: connect real ATS scores from Section 1 to the panel