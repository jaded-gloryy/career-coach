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