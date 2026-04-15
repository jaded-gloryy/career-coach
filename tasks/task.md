On page load, the intake & fit agent should be auto selected. 

The message bar should grow in height to fit the message the user types.

In agents/agent1_intake.py, add directions to save the intake summary as a doc for the user. You can make an endpoint for this. Make sure the other agents also save their ouputs to the db for use downstream. Also ensure the agents try to fetch the data they need before determining if they need to ask the user. The intake agent doesn't need to check first, since it's the first agent in the pipeline. It will request directly from the user. _extract_text() can also accept .json and .md.

Ensure we're effectively extracting text and compacting documents before passing them to any LLM. The LLM shouldn't need to parse the document. Our system should handle that first and limit the context were passing to limit token usage.


____Phase 2____
- add a loading skeleton for file uploads

Progress UI Panel
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
Validator agent (Agent 4) also returns an job_fit_score — this is the authoritative score; Agent 1's score is a working estimate.