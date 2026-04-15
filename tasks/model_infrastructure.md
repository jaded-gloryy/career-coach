Section 1 — Model Infrastructure: Anthropic API + Agent Routing
What it is: Swap the inference layer to Anthropic, configure per-agent model selection, and add the Haiku/Sonnet split for Agent 2.
Tasks:

Replace current inference client with anthropic SDK
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