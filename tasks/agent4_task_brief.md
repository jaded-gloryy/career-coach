# Task brief: Agent 4 — validation service (two modes)

**Phase:** 2 of 2  
**Scope:** Backend · Agents · Prompts  
**Estimate:** 2–3 days

---

## Objective

Refactor Agent 4 from a terminal QA pass into a reusable validation service with two distinct modes. Mode A validates resume rewrites before surfacing them to the user. Mode B runs an active interview coaching loop. Both modes share the same agent infrastructure but use separate system prompts and invoke different call patterns.

---

## Mode A — Resume validator (after Agent 2)

### Behavior

Agent 4 receives the resume rewrite and the user's `fact_sheet` JSONB from `resume_snapshots`. It evaluates each claim in the rewrite against the source material and flags anything that outpaces the evidence.

Flag categories:

- **Unsupported quantification** — a number or percentage appears in the rewrite with no basis in the fact sheet
- **Scope inflation** — ownership language ("led", "owned", "built") where the fact sheet says contribution language
- **Orphaned skills** — skills listed with no supporting project or role in the source material

### Output schema (Haiku structured call)

```json
{
  "verdict": "pass | needs_revision",
  "flags": [
    {
      "claim": "string — the exact phrase from the rewrite",
      "issue": "unsupported_quantification | scope_inflation | orphaned_skill",
      "suggestion": "string — specific, actionable fix"
    }
  ]
}
```

### Delivery pattern — soft advisory

Agent 4 runs before the rewrite is surfaced to the user, but does not hard-block delivery. The flow:

```
Agent 2 completes rewrite
  → backend calls Agent 4 Mode A (Haiku, structured output)
  → verdict = pass → stream rewrite to user, no flags shown
  → verdict = needs_revision → stream rewrite to user with flags
     rendered inline as callout blocks via __PANEL_UPDATE__
```

Flags surface as advisory callouts, not errors. The user decides what to act on. A targeted Haiku re-edit (existing Agent 2 path) is offered per flag, not as a batch rewrite.

### Prompt file

`/prompts/agent4_resume_validation.txt`

Behavioral requirements for the prompt:

- Compare only against the provided fact sheet — do not invent source material
- Flag conservatively; a reasonable interpretation of the rewrite should pass
- Output JSON only, no prose

---

## Mode B — Interview coaching loop (after Agent 3)

### Two-phase structure

**Phase 1 — Question generation (Agent 3)**  
Agent 3 generates 8–12 tailored interview questions based on the intake summary and latest resume rewrite. This is Agent 3's complete output. No pre-coaching, no analysis.

**Phase 2 — Practice session (Agent 4 Mode B)**  
Triggered when the user signals they are ready to practice ("let's go", "run me through them", etc.). Agent 3's question set is injected into Agent 4's context alongside the resume fact sheet.

### Coaching loop per question

```
Ask question N
  → user answers
  → Call 1: Agent 4 (Haiku, structured evaluation)
      → { score: int, gaps: [str], follow_up: str | null }
  → Call 2: Agent 4 (Sonnet, conversational coaching response)
      → if score ≥ 90: brief affirmation, natural transition to question N+1
      → if score < 90: targeted feedback + one follow-up question
          → user answers follow-up
          → re-evaluate (same two-call pattern)
          → if score ≥ 90: transition
          → if score < 90: transition anyway, leave a brief coaching note
```

Two follow-up attempts maximum per question. The session does not stall.

### Evaluation call schema (Haiku)

```json
{
  "score": 0,
  "gaps": ["string — specific missing element"],
  "follow_up": "string | null — a single clarifying question, null if score ≥ 90"
}
```

Scoring rubric to specify in the evaluation prompt:

| Score range | Meaning |
|---|---|
| 90–100 | Claim is specific, backed by evidence from the resume, and complete |
| 70–89 | Mostly good but missing one specific detail or quantifier |
| 50–69 | On topic but vague — no evidence cited |
| < 50 | Off topic, generic, or contradicts the resume |

### Conversational call (Sonnet)

The Sonnet call receives the evaluation JSON plus the full conversation history for this question. It produces the user-facing response.

Behavioral requirements for the conversational prompt:

- On pass: acknowledge what worked in one sentence, move to the next question without announcing the score aloud — score surfaces via `__PANEL_UPDATE__` only
- On follow-up: deliver feedback in one or two sentences, ask exactly one follow-up question, do not restate the user's answer back to them
- Transition language should feel like a real interviewer, not a grading rubric
- Do not use phrases like "great answer" or "excellent" — be specific about what worked

### Prompt files

`/prompts/agent4_interview_evaluation.txt` — Haiku evaluation call  
`/prompts/agent4_interview_coaching.txt` — Sonnet conversational call

---

## Session state

Track loop progress in the `metadata` JSONB column on the `messages` table (from Phase 1 brief). Persist per assistant message so the session can be resumed on reconnect.

```json
{
  "mode": "interview_practice",
  "question_index": 3,
  "total_questions": 10,
  "scores": [92, 78, 85],
  "follow_up_count": 1,
  "session_complete": false
}
```

`follow_up_count` resets to 0 on each new question. `session_complete` flips to `true` after question N is finished and triggers a session summary.

---

## Session summary

After the final question, Agent 4 delivers a short debrief in natural language:

- Average score across all questions
- One or two questions to revisit before the interview
- One concrete thing the user did well

No structured output needed here — this is a Sonnet prose response.

---

## Backend routing changes

Agent 4 is no longer a sequential pipeline step. It is invoked as a gate or sub-call by the backend at two points:

```
/chat/2/stream completes → backend calls agent4_resume_validation
/chat/3/stream completes + user signals practice intent → backend initializes agent4_interview_loop
```

The agent_id = 4 row in the DB distinguishes Mode A messages from Mode B messages via the `metadata.mode` field.

---

## File changes summary

| File | Change |
|---|---|
| `/prompts/agent4_resume_validation.txt` | New — Haiku structured output prompt |
| `/prompts/agent4_interview_evaluation.txt` | New — Haiku evaluation prompt |
| `/prompts/agent4_interview_coaching.txt` | New — Sonnet conversational prompt |
| `base.py` | Add Mode A gate after Agent 2 stream completes |
| `base.py` | Add practice intent detection to trigger Mode B |
| `session.py` | Track `question_index`, `follow_up_count`, `session_complete` |
| `index.html` | Render flag callouts for Mode A advisory output |

---

## Out of scope for this task

Hard gate / blocking behavior for Mode A · auth · frontend redesign · context compression · semantic retrieval
