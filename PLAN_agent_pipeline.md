# Plan: Connected Agent Pipeline with Context-Preserving Mode Switching

**Goal:** Users can cycle between Intake / Resume / Interview tabs at any time without losing conversation context. After an agent completes a milestone output, the system suggests (or optionally auto-switches) to the next agent in the pipeline.

---

## Phase 0: Documentation Discovery — Findings

All patterns below are from reading the live codebase, not assumptions.

### Allowed APIs / Patterns

| Concern | File | Key Detail |
|---------|------|-----------|
| Agent switching state | `frontend/src/contexts/ChatContext.jsx:26-32` | `SET_AGENT` currently resets `conversationId` and `messages` — this is the root bug |
| Loading conversation | `frontend/src/contexts/ChatContext.jsx:98-119` | `LOAD_CONVERSATION` maps messages but never sets `activeAgent` |
| Sidebar load | `frontend/src/components/layout/ConversationSidebar.jsx:64-79` | Fetches `/chat/conversations/{id}/messages` and dispatches `LOAD_CONVERSATION` |
| Message agent_id | `app/db.py:337-363` | `load_conversation_history` returns `{role, content, agent_id, metadata}` — `agent_id` is int 1-4 |
| SSE event parsing | `frontend/src/hooks/useStream.js:39-71` | All SSE events follow `data: [KEYWORD] payload\n\n` pattern |
| SSE emitting | `app/routers/chat.py:162-178` | `_stream_with_confirm()` wrapper pattern — append new SSE events after `[DONE]` |
| Panel state | `app/routers/chat.py:159-160` | `on_panel` callback calls `db.upsert_conversation_panel_state()` |
| Context injection | `app/agents/base.py:116-160` | agent2 loads `intake_summary` doc; agent3 loads both `intake_summary` + `resume_rewrite` |
| Interview routing | `app/routers/chat.py:115-138` | agent3 + practice intent phrases → `stream_interview_session()` special path |

### Anti-patterns to Avoid

- Do NOT reset `conversationId` on agent tab click (current bug)
- Do NOT emit `[HANDOFF]` during the interview practice loop (already routed separately; would confuse state)
- Do NOT auto-switch agents mid-stream — only suggest after `[DONE]`
- Do NOT add `activeAgent` to the DB — it's UI state; derive it from the last assistant `agent_id` in message history

---

## Phase 1: Fix Agent Switching — Preserve Conversation Context

**What:** Change `SET_AGENT` so it only updates the active tab. The conversation ID and messages stay intact. A new conversation is only created via "New Chat".

**File:** `frontend/src/contexts/ChatContext.jsx`

### Task 1.1 — Fix `SET_AGENT` reducer

```diff
- case 'SET_AGENT':
-   return {
-     ...state,
-     activeAgent: action.agent,
-     conversationId: crypto.randomUUID(),
-     messages: [],
-   }
+ case 'SET_AGENT':
+   return {
+     ...state,
+     activeAgent: action.agent,
+   }
```

Lines to change: 26-32. Remove `conversationId` and `messages` reset.

### Task 1.2 — Update `LOAD_CONVERSATION` to restore `activeAgent`

When a conversation is loaded from the sidebar, detect which agent was last used by finding the last message with a non-null `agent_id`.

```diff
  case 'LOAD_CONVERSATION': {
    const stored = action.panelState
+   // Detect the last agent used in this conversation
+   const lastAgentMsg = [...action.messages].reverse().find(m => m.agent_id != null)
+   const restoredAgent = lastAgentMsg ? `agent${lastAgentMsg.agent_id}` : state.activeAgent
    return {
      ...state,
      conversationId: action.conversationId,
+     activeAgent: restoredAgent,
      messages: action.messages.map(m => ({
        id: crypto.randomUUID(),
        role: m.role,
        text: m.content,
        cards: [],
      })),
      ...
    }
  }
```

Lines to change: 98-119. Add `activeAgent: restoredAgent` to the returned state object.

### Verification

- Click a tab while chatting → messages stay, conversationId stays, only active tab pill changes
- Click a conversation in sidebar → active tab switches to match the last agent used
- Grep: `conversationId: crypto.randomUUID()` should only appear in `NEW_CONVERSATION` and `initialState`, not `SET_AGENT`

---

## Phase 2: Backend Handoff Signals — `[HANDOFF]` SSE Event

**What:** After Agent 1 and Agent 2 complete their primary output, emit a `[HANDOFF]` SSE event suggesting the next agent. Frontend uses this to show a non-blocking suggestion banner.

**Conditions:**
- Agent 1 → suggest Agent 2 always (intake always leads to resume work)
- Agent 2 → suggest Agent 3 only on first-time rewrite (when `history` had no prior assistant turns = `not any(m["role"] == "assistant" for m in history)`)
- Agent 3 → no automatic handoff (interview is the terminal stage; practice loop has its own flow)
- Agent 4 → no handoff (validator is a utility, not a pipeline step)

**File:** `app/routers/chat.py`

### Task 2.1 — Add handoff logic to `_stream_with_confirm()`

After the existing `[CONFIRM_SAVE]` block, check `agent_id` and emit `[HANDOFF]` when appropriate:

```python
# At top of file, add handoff map
_AGENT_HANDOFFS: dict[str, dict] = {
    "agent1": {"next_agent": "agent2", "label": "Resume Coach", "message": "Intake complete — ready to work on your resume."},
    "agent2": {"next_agent": "agent3", "label": "Interview Coach", "message": "Resume ready — time to prep for interviews."},
}

# Inside _stream_with_confirm(), after the [CONFIRM_SAVE] yield:
if chunk.strip() == "data: [DONE]" and agent_id in _AGENT_HANDOFFS:
    # For agent2, only suggest interview handoff on a first rewrite (no prior assistant turns)
    is_first_rewrite = agent_id == "agent2" and not any(m["role"] == "assistant" for m in history)
    if agent_id == "agent1" or is_first_rewrite:
        handoff = _AGENT_HANDOFFS[agent_id]
        payload = json.dumps(handoff)
        yield f"data: [HANDOFF] {payload}\n\n"
```

Note: `history` is available in scope since `_stream_with_confirm()` is a closure inside `chat_stream()`.

### Verification

- After chatting with agent1, SSE stream should end with `data: [HANDOFF] {"next_agent": "agent2", ...}`
- After agent2 first rewrite, SSE stream ends with `data: [HANDOFF] {"next_agent": "agent3", ...}`
- After agent2 follow-up edits, no `[HANDOFF]`
- After agent3/4, no `[HANDOFF]`
- Grep: `[HANDOFF]` appears in `chat.py` emit only, nowhere in agent system prompts

---

## Phase 3: Frontend — Handle `[HANDOFF]` Events

**What:** Parse `[HANDOFF]` SSE events in `useStream.js`, store the suggestion in `ChatContext`, and show a dismissible banner that lets the user switch agents with one click.

### Task 3.1 — Add `handoffSuggestion` to `ChatContext`

**File:** `frontend/src/contexts/ChatContext.jsx`

Add to `initialState`:
```js
handoffSuggestion: null,  // { next_agent, label, message } | null
```

Add two new cases to the reducer:
```js
case 'SET_HANDOFF':
  return { ...state, handoffSuggestion: action.suggestion }

case 'CLEAR_HANDOFF':
  return { ...state, handoffSuggestion: null }
```

Also clear `handoffSuggestion` in `SET_AGENT`, `NEW_CONVERSATION`, and `LOAD_CONVERSATION` returns:
```js
handoffSuggestion: null,
```

### Task 3.2 — Parse `[HANDOFF]` in `useStream.js`

**File:** `frontend/src/hooks/useStream.js`

Add after the existing `[CONFIRM_SAVE]` branch (line ~55):
```js
if (data.startsWith('[HANDOFF] ')) {
  dispatch({ type: 'SET_HANDOFF', suggestion: JSON.parse(data.slice(10)) })
  continue
}
```

### Task 3.3 — Create `HandoffBanner` component

**File:** `frontend/src/components/layout/HandoffBanner.jsx` (new file)

```jsx
import { useChat } from '../../contexts/ChatContext'

export function HandoffBanner() {
  const { state, dispatch } = useChat()
  const s = state.handoffSuggestion
  if (!s) return null

  function accept() {
    dispatch({ type: 'SET_AGENT', agent: s.next_agent })
    dispatch({ type: 'CLEAR_HANDOFF' })
  }

  function dismiss() {
    dispatch({ type: 'CLEAR_HANDOFF' })
  }

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 bg-pink-50 border-b border-pink-100 text-sm">
      <span className="text-pink-700 flex-1">{s.message}</span>
      <button
        onClick={accept}
        className="px-3 py-1 rounded-full bg-pink-500 text-white text-xs font-medium hover:bg-pink-600 transition-colors"
      >
        Switch to {s.label} →
      </button>
      <button
        onClick={dismiss}
        className="text-pink-300 hover:text-pink-500 text-xs"
      >
        Dismiss
      </button>
    </div>
  )
}
```

### Task 3.4 — Mount `HandoffBanner` in `ChatLayout`

**File:** `frontend/src/components/layout/ChatLayout.jsx`

```diff
+ import { HandoffBanner } from './HandoffBanner'
  ...
  <div className="bg-white rounded-card shadow-[0_4px_24px_rgba(236,72,153,0.08)] overflow-hidden flex flex-col">
    <AgentSwitcher onAgentChange={fileAttachments.clearFiles} />
+   <HandoffBanner />
    <ChatWindow />
    <MessageInput fileAttachments={fileAttachments} />
  </div>
```

### Verification

- After agent1 response: pink banner appears below tab row saying "Intake complete — ready to work on your resume."
- Click "Switch to Resume Coach →": tab switches to agent2, banner disappears, messages preserved
- Click Dismiss: banner gone, still on agent1, messages preserved
- After agent2 first rewrite: banner appears suggesting Interview Coach
- After agent2 follow-up edit: no banner
- Switching tabs manually: banner clears
- New Chat: banner clears
- Grep: `SET_HANDOFF` / `CLEAR_HANDOFF` only in ChatContext reducer and where dispatched

---

## Phase 4: Final Verification Checklist

**Context preservation:**
- [ ] Switch from agent1 → agent2 tab mid-conversation: all messages still visible
- [ ] Switch agent2 → agent3: messages preserved
- [ ] Load old conversation from sidebar: active tab matches last agent used

**Handoff banner:**
- [ ] Agent1 response triggers banner with "Resume Coach" suggestion
- [ ] Agent2 first rewrite triggers banner with "Interview Coach" suggestion  
- [ ] Agent2 follow-up edit does NOT trigger banner
- [ ] Agent3/4 responses: no banner
- [ ] Accept button switches agent and clears banner
- [ ] Dismiss clears banner without switching
- [ ] New Chat clears banner
- [ ] Loading a different conversation clears banner

**Anti-patterns (grep checks):**
- [ ] `conversationId: crypto.randomUUID()` appears only in `NEW_CONVERSATION` case and `initialState`
- [ ] No `messages: []` in `SET_AGENT` case
- [ ] `[HANDOFF]` not emitted for agent3 or agent4
- [ ] `[HANDOFF]` not emitted during interview practice loop (`stream_interview_session`)

**Context injection still works:**
- [ ] Agent2 still receives intake_summary in system prompt (no change to base.py)
- [ ] Agent3 still receives intake_summary + resume_rewrite (no change to base.py)

---

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/contexts/ChatContext.jsx` | Fix SET_AGENT; add LOAD_CONVERSATION agent restore; add handoffSuggestion state + SET_HANDOFF/CLEAR_HANDOFF cases |
| `frontend/src/hooks/useStream.js` | Parse [HANDOFF] SSE event |
| `frontend/src/components/layout/HandoffBanner.jsx` | New component (create) |
| `frontend/src/components/layout/ChatLayout.jsx` | Import + mount HandoffBanner |
| `app/routers/chat.py` | Add _AGENT_HANDOFFS dict + emit [HANDOFF] after [DONE] for agent1/agent2 |

**No changes needed to:** `base.py`, `db.py`, `session.py`, `AgentSwitcher.jsx`, `ConversationSidebar.jsx`, `useConversations.js`
