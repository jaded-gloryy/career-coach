Implementation Plan: Architect Findings P1–P11    
                                     
 Context

 Following the /purpose-architect analysis (see docs/architect-findings.md), 5 red flags and 11 improvement priorities were identified
 across the career-coach multi-agent system. The highest-value work is prompt caching (P1–P4), which requires a one-time structural
 refactor of base.py to enable all subsequent cache wins. Output optimization (P5–P7) and observability/correctness (P8–P11) follow.

 Estimated total savings: 40–88% reduction on system-input tokens per session + 1,300–2,840 output tokens per long session.

 ---
 Phase 1: Caching Infrastructure (P1–P4)

 P1 — Convert system prompt string → block array in base.py

 File: app/agents/base.py

 What: Refactor _augment_system_prompt() (lines 93–193) to return a list[dict] (block array) instead of a plain string. Update all
 callers (stream_agent() at line 255, call_agent() at line 489) to pass system=blocks instead of system=string.

 How:
 - _augment_system_prompt() currently returns str. Change return type to list[dict].
 - The static agent system prompt becomes block[0]: {"type": "text", "text": <static_prompt>}
 - Injected context (intake summary, resume, etc.) becomes subsequent blocks.
 - Both stream_agent() and call_agent() already accept the system= kwarg — no signature change needed, just pass the list.

 Note: Anthropic SDK accepts system as either a string or a list of content blocks. Switching to a list is non-breaking.

 ---
 P2 — cache_control on Agent 2 static block (~1,200–1,500 tokens)

 File: app/agents/base.py (inside _augment_system_prompt())

 What: Add "cache_control": {"type": "ephemeral"} to Agent 2's static system prompt block. Agent 2's static prompt is ~1,200–1,500
 tokens, well above the 1,024-token cache threshold.

 How: When building blocks for Agent 2, mark the static-prompt block:
 {"type": "text", "text": agent2_static_prompt, "cache_control": {"type": "ephemeral"}}

 Expected savings: ~40% reduction per Agent 2 call on cached calls.

 ---
 P3 — cache_control on Agent 2 intake-summary injection (~1,525–1,639 tokens)

 File: app/agents/base.py (inside _augment_system_prompt(), Agent 2 branch)

 What: The Agent 2 augmentation injects the Agent 1 intake summary as a context block. Mark this block with cache_control as a second
 cache breakpoint.

 How: After the static prompt block, add the intake summary as:
 {"type": "text", "text": intake_summary_text, "cache_control": {"type": "ephemeral"}}

 Expected savings: ~88% reduction on system input after turn 1 (cache hit on both blocks).

 ---
 P4 — cache_control on Agent 3 injected context (~1,600–3,700 tokens)

 File: app/agents/base.py (inside _augment_system_prompt(), Agent 3 branch)

 What: Agent 3 receives intake summary + latest resume rewrite as injected context. This dynamic block changes once per session (when
 resume is finalized) then stays stable. Mark it with cache_control.

 How: Same pattern as P3 — mark the injected context block with "cache_control": {"type": "ephemeral"}.

 Expected savings: ~1,600–3,700 tokens at 90% cache discount per interview coaching turn after turn 1.

 ---
 Phase 2: Output Optimization (P5–P7)

 P5 — Agent 1: delta CONTEXT SUMMARY on revisions (240–540 tok/session)

 File: app/agents/agent1_intake.py

 What: Agent 1 currently reproduces the full CONTEXT SUMMARY block on every score revision (turns 3, 4, 5). Add a prompt rule that on
 revision turns, only output changed fields, not the full block.

 How: Add a rule to the Agent 1 system prompt:

 ▎ "On score revisions (when updating a previously issued CONTEXT SUMMARY), output only the fields that changed prefixed with [UPDATED].
 ▎ Do not reproduce unchanged fields."

 ---
 P6 — Agent 1: suppress unchanged gap items (60–300 tok/session)

 File: app/agents/agent1_intake.py

 What: Gap items (e.g., "Graduate/doctoral degree gap") are repeated verbatim across turns even when nothing changed. Add a prompt rule
 to suppress unchanged gaps.

 How: Add a rule to the Agent 1 system prompt:

 ▎ "When listing gap items, only enumerate gaps that have changed or been newly identified. Reference previously mentioned unchanged gaps
 ▎  by name only (e.g., 'Graduate/doctoral degree gap — unchanged')."

 ---
 P7 — Agent 3: back-reference rule for repeated content anchors (1,000–2,000 tok/long session)

 File: app/agents/agent3_interview.py

 What: Agent 3 regenerates full content anchors verbatim across multiple turns (e.g., "Regeneron FDA filing story" repeated 3×,
 "Playwright/Salesforce gap flags" repeated 4×). Add a back-reference rule.

 How: Add a rule to the Agent 3 system prompt:

 ▎ "When referencing a story, example, or gap flag you have already detailed in this conversation, cite it by name and turn number only
 ▎ (e.g., 'FDA filing story [Turn 2]'). Do not reproduce the full text."

 ---
 Phase 3: Observability & Correctness (P8–P11)

 P8 — Add Trace + token accounting to stream_interview_session

 File: app/agents/base.py (lines 364–473)

 What: stream_interview_session() makes two API calls (Haiku eval + Sonnet coaching) with no Trace creation, no token capture, no
 save_trace() call. This is a telemetry gap.

 How:
 1. Create a Trace at the start of stream_interview_session() for each sub-call.
 2. Capture usage from both the eval response (eval_response.usage) and the stream final message.
 3. Fire-and-forget _save_trace() for each, passing the conversation_id and user_id already available in scope.

 ---
 P9 — Fix agent4-as-intake routing bug

 Files: app/routers/chat.py, frontend routing code

 What: Conversation b98a6583 shows Agent 4 (Validator) being used as the intake agent, generating "Starting Your Career Transition"
 language. Agent 4's system prompt is a truth validator — not an intake agent.

 Investigation needed: Read routers/chat.py and the frontend AgentSwitcher to find where agent_id is determined on conversation start.
 The bug is likely that agent_id=4 can be passed on the first turn without guard.

 Fix: Add a guard in chat.py (or session.py) that if this is the first turn of a conversation (no prior messages), reject agent_id values
  other than 1. Return a 400 with a clear error message. Alternatively, auto-redirect to agent 1 on first turn if no history exists.

 ---
 P10 — Populate job_title on conversation creation

 Files: app/db.py, app/agents/base.py or app/routers/chat.py

 What: All 6 conversations have job_title = NULL in the database. The job_title is captured in panel_state when Agent 1 emits a
 __PANEL_UPDATE__ block, but never written back to the conversations table.

 How:
 1. In db.py, add function update_conversation_job_title(conversation_id: str, job_title: str) — a single UPDATE conversations SET
 job_title=$2 WHERE id=$1::uuid.
 2. In base.py (or routers/chat.py), where panel updates are parsed from the SSE stream, detect when job_title is non-null in the panel
 payload and call update_conversation_job_title() as a background task.
 3. The panel_state parsing already happens in the stream response — find that location and hook in the DB update.

 ---
 P11 — Add "project context" doc type; inject for Agent 3

 Files: app/db.py (document types), app/agents/base.py (_augment_system_prompt() Agent 3 branch)

 What: Agent 3 (Interview Coach) currently receives intake summary + resume rewrite but has no access to project-level context documents
 (e.g., specific project portfolios, GitHub work, portfolio write-ups) that would improve coaching quality.

 How:
 1. In db.py, add retrieval for doc_type 'project_context' — query user documents where doc_type = 'project_context'.
 2. In _augment_system_prompt() Agent 3 branch, fetch project context docs and append as an additional block after the resume block.
 3. Optionally add an upload endpoint or UI affordance for users to add project context — defer if doc upload already exists for other
 doc types (check existing upload logic first).

 ---
 Critical Files

 ┌────────────────────────────────┬──────────────────────────────────────────────────────────────┐
 │              File              │                          Relevance                           │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/agents/base.py:93–193      │ _augment_system_prompt() — all cache_control changes go here │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/agents/base.py:255–280     │ stream_agent() — system= kwarg call site                     │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/agents/base.py:364–473     │ stream_interview_session() — P8 trace gap                    │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/agents/base.py:489–494     │ call_agent() — second system= call site                      │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/agents/agent1_intake.py    │ P5, P6 prompt rule additions                                 │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/agents/agent3_interview.py │ P7 prompt rule addition                                      │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/db.py:241                  │ create_conversation() — P10 job_title                        │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/db.py:378                  │ save_trace() — reference for P8                              │
 ├────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 │ app/routers/chat.py            │ P9 agent routing guard, P10 panel update hook                │
 └────────────────────────────────┴──────────────────────────────────────────────────────────────┘

 ---
 Implementation Order

 Execute phases in order — P1 is a prerequisite for P2–P4:

 1. P1 → refactor _augment_system_prompt() to return blocks (no behavior change yet)
 2. P2, P3, P4 → add cache_control to eligible blocks (parallel, same file)
 3. P5, P6 → Agent 1 prompt additions (2-line additions, no code change)
 4. P7 → Agent 3 prompt addition (1-line addition)
 5. P8 → Wire Trace into stream_interview_session
 6. P9 → Add first-turn agent routing guard
 7. P10 → Populate job_title from panel updates
 8. P11 → Project context doc injection for Agent 3

 ---
 Verification

 - P1–P4 (caching): After deploying, run a multi-turn Agent 2 session and check request_traces table — cache_read_input_tokens should be
 non-zero on turns 2+. Also check Anthropic console cache hit metrics.
 - P5–P7 (output): Manual review of Agent 1 and Agent 3 responses across 3+ turns to confirm deltas only and no verbatim repetition.
 - P8 (traces): Run an interview session and confirm new rows appear in request_traces with non-null input_tokens.
 - P9 (routing): POST /chat/4 with an empty conversation — should return 400 or auto-redirect to agent 1.
 - P10 (job_title): Start a new conversation with Agent 1, provide a target role — confirm conversations.job_title is non-null in DB
 after the intake panel update fires.
 - P11 (project context): Upload a project context doc and confirm Agent 3 includes it in a subsequent session.