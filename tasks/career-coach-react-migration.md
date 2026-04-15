# Career Coach — React Migration Plan

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | Vite + React 18 | Fast HMR, no Next.js overhead needed |
| Styling | Tailwind CSS | Replaces the inline CSS vars 1:1, dark mode automatic |
| Auth | `@supabase/auth-helpers-react` | Drop-in wrapper around existing `_sb` client |
| Streaming | Native `fetch` + `ReadableStream` | No library needed, same logic as vanilla version |
| State | `useContext` + `useReducer` | No Redux — app is not complex enough to justify it |
| File uploads | Custom hook `useFileAttachments` | Wraps skeleton chip + upload logic |

---

## File Structure

```
src/
├── main.jsx
├── App.jsx                      # AuthProvider + routing
│
├── contexts/
│   ├── AuthContext.jsx           # currentSession, signIn, signOut, signUp
│   └── ChatContext.jsx           # activeAgent, conversationId, panelState
│
├── hooks/
│   ├── useStream.js              # SSE fetch + [PANEL], [VALIDATION], [TRACE] parsing
│   ├── useFileAttachments.js     # attachedFiles, uploadFile, removeFile, consumeFiles
│   └── useAutoResize.js          # textarea auto-height
│
├── components/
│   ├── auth/
│   │   └── AuthScreen.jsx
│   ├── layout/
│   │   ├── ChatLayout.jsx
│   │   ├── ProgressPanel.jsx     # ScoreRing lives here as a sub-component
│   │   └── AgentSwitcher.jsx
│   ├── chat/
│   │   ├── ChatWindow.jsx
│   │   ├── UserMessage.jsx
│   │   ├── AssistantMessage.jsx  # renders text + child cards + download btn
│   │   └── StreamingMessage.jsx  # live-updating bubble during stream
│   ├── cards/
│   │   ├── ValidationCard.jsx
│   │   ├── ConfirmSaveCard.jsx
│   │   └── TracePanel.jsx
│   └── input/
│       ├── MessageInput.jsx
│       ├── FileChip.jsx
│       └── UploadButton.jsx
│
└── lib/
    └── supabase.js               # createClient — imported once, used everywhere
```

---

## Component Tree

```
App (AuthProvider · SupabaseContext)
├── AuthScreen           — sign-in / sign-up tabs (shown when no session)
└── ChatLayout           — main shell when authed
    ├── ProgressPanel    — score ring · job title · session summary
    ├── AgentSwitcher    — tab buttons · active state
    ├── ChatWindow       — scrollable message list
    │   ├── UserMessage
    │   ├── AssistantMessage
    │   │   ├── ValidationCard
    │   │   ├── ConfirmSaveCard
    │   │   └── TracePanel
    │   └── StreamingMessage   — live-updating bubble during stream
    └── MessageInput     — textarea · upload · send
        ├── FileChip
        └── UploadButton
```

---

## State Architecture

### AuthContext

Wraps the entire app. Handles Supabase session lifecycle.

```jsx
// contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_, s) => setSession(s)
    )
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, signIn, signOut, signUp }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

### ChatContext + Reducer

Conversation-scoped state. All SSE events dispatch into this reducer.

```js
// contexts/ChatContext.jsx
const AGENT_LABELS = {
  agent1: 'Intake & Fit',
  agent2: 'Resume Coach',
  agent3: 'Interview Coach',
  agent4: 'Validator',
}

const initialState = {
  activeAgent: 'agent1',
  conversationId: crypto.randomUUID(),
  messages: [],        // { id, role, text, cards: [] }
  streaming: false,
  panelState: {
    jobFitScore: null,
    jobTitle: null,
    lastAction: null,
    sectionsModified: null,
  },
}

function chatReducer(state, action) {
  switch (action.type) {

    case 'SET_AGENT':
      return {
        ...state,
        activeAgent: action.agent,
        conversationId: crypto.randomUUID(),
        messages: [],
      }

    case 'PUSH_MSG':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: crypto.randomUUID(), role: action.role, text: action.text, cards: [] },
        ],
      }

    case 'APPEND_CHUNK': {
      const msgs = [...state.messages]
      const last = { ...msgs[msgs.length - 1] }
      last.text += action.chunk
      msgs[msgs.length - 1] = last
      return { ...state, messages: msgs }
    }

    case 'FINALIZE_MSG': {
      // Strip any PANEL_UPDATE block that leaked into the bubble
      const msgs = [...state.messages]
      const last = { ...msgs[msgs.length - 1] }
      last.text = last.text
        .replace(/\n*__PANEL_UPDATE__[\s\S]*?__END_PANEL__\n*/g, '')
        .trimEnd()
      msgs[msgs.length - 1] = last
      return { ...state, messages: msgs, streaming: false }
    }

    case 'PUSH_CARD': {
      const msgs = [...state.messages]
      const last = { ...msgs[msgs.length - 1] }
      last.cards = [...last.cards, action.card]
      msgs[msgs.length - 1] = last
      return { ...state, messages: msgs }
    }

    case 'APPLY_PANEL':
      return {
        ...state,
        panelState: {
          ...state.panelState,
          ...(action.data.job_fit_score != null && { jobFitScore: action.data.job_fit_score }),
          ...(action.data.job_title != null && { jobTitle: action.data.job_title }),
          ...(action.data.last_action != null && { lastAction: action.data.last_action }),
          ...(action.data.sections_modified != null && { sectionsModified: action.data.sections_modified }),
        },
      }

    case 'SET_STREAMING':
      return { ...state, streaming: action.streaming }

    default:
      return state
  }
}
```

---

## Key Hook — useStream

The SSE parser extracted from the vanilla `sendMessage` function. All event routing lives here.

```js
// hooks/useStream.js
import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../contexts/ChatContext'

export function useStream() {
  const { session } = useAuth()
  const { dispatch } = useChat()

  async function sendMessage(agentId, conversationId, message) {
    dispatch({ type: 'SET_STREAMING', streaming: true })
    dispatch({ type: 'PUSH_MSG', role: 'user', text: message })
    dispatch({ type: 'PUSH_MSG', role: 'assistant', text: '' })

    const res = await fetch(`/chat/${agentId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ conversation_id: conversationId, message }),
    })

    if (!res.ok) {
      dispatch({ type: 'APPEND_CHUNK', chunk: `[HTTP ${res.status}]` })
      dispatch({ type: 'SET_STREAMING', streaming: false })
      return
    }

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)

        if (data === '[DONE]') {
          dispatch({ type: 'FINALIZE_MSG' })
          continue
        }
        if (data.startsWith('[PANEL] ')) {
          dispatch({ type: 'APPLY_PANEL', data: JSON.parse(data.slice(8)) })
          continue
        }
        if (data.startsWith('[VALIDATION] ')) {
          dispatch({ type: 'PUSH_CARD', card: { type: 'validation', data: JSON.parse(data.slice(13)) } })
          continue
        }
        if (data.startsWith('[CONFIRM_SAVE] ')) {
          dispatch({ type: 'PUSH_CARD', card: { type: 'confirm_save', data: JSON.parse(data.slice(15)) } })
          continue
        }
        if (data.startsWith('[TRACE] ')) {
          dispatch({ type: 'PUSH_CARD', card: { type: 'trace', data: JSON.parse(data.slice(8)) } })
          continue
        }
        if (data.startsWith('[ERROR]')) {
          dispatch({ type: 'APPEND_CHUNK', chunk: `\n\n${data}` })
          dispatch({ type: 'SET_STREAMING', streaming: false })
          return
        }

        dispatch({ type: 'APPEND_CHUNK', chunk: data.replace(/\\n/g, '\n') })
      }
    }

    dispatch({ type: 'SET_STREAMING', streaming: false })
  }

  return { sendMessage }
}
```

---

## Key Hook — useFileAttachments

```js
// hooks/useFileAttachments.js
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function useFileAttachments() {
  const { session } = useAuth()
  const [files, setFiles] = useState([])   // { id, name, text }
  const [uploading, setUploading] = useState(false)

  async function uploadFile(file) {
    setUploading(true)
    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/upload/resume', {
        method: 'POST',
        body: form,
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const data = await res.json()
      setFiles(prev => [...prev, { id: crypto.randomUUID(), name: file.name, text: data.extracted_text }])
    } finally {
      setUploading(false)
    }
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  function consumeFiles() {
    const texts = files.map(f => f.text)
    setFiles([])
    return texts
  }

  function clearFiles() {
    setFiles([])
  }

  return { files, uploading, uploadFile, removeFile, consumeFiles, clearFiles }
}
```

---

## Key Hook — useAutoResize

```js
// hooks/useAutoResize.js
import { useEffect, useRef } from 'react'

export function useAutoResize() {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    function resize() {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
    el.addEventListener('input', resize)
    return () => el.removeEventListener('input', resize)
  }, [])

  return ref
}
```

---

## ScoreRing Component

The vanilla version mutates `strokeDashoffset` directly on a DOM element. In React, drive it from state.

```jsx
// Inside ProgressPanel.jsx
const CIRCUMFERENCE = 150.8

function ScoreRing({ score }) {
  const offset = score !== null
    ? CIRCUMFERENCE * (1 - Math.min(100, score) / 100)
    : CIRCUMFERENCE

  const color = score === null ? 'var(--color-border-secondary)'
    : score >= 75 ? '#22c55e'
    : score >= 50 ? '#f59e0b'
    : '#ef4444'

  return (
    <div className="relative w-14 h-14">
      <svg viewBox="0 0 60 60" className="w-14 h-14 -rotate-90">
        <circle cx="30" cy="30" r="24" fill="none" stroke="var(--pink-100)" strokeWidth="5" />
        <circle
          cx="30" cy="30" r="24" fill="none"
          stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">
        {score ?? '—'}
      </div>
    </div>
  )
}
```

---

## ConfirmSaveCard Component

The vanilla version toggles `textarea.disabled` imperatively. In React, use a `disabled` state boolean.

```jsx
// components/cards/ConfirmSaveCard.jsx
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

const ROLE_LABELS = {
  intake_summary: 'Intake Summary',
  resume_rewrite: 'Resume Rewrite',
  interview_prep: 'Interview Prep',
}

export function ConfirmSaveCard({ data }) {
  const { session } = useAuth()
  const [content, setContent] = useState(data.content)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const label = ROLE_LABELS[data.role] || data.role

  async function save() {
    await fetch('/chat/confirm-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ conversation_id: data.conversation_id, role: data.role, content, confirmed: true }),
    })
    setSaved(true)
  }

  async function skip() {
    await fetch('/chat/confirm-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ conversation_id: data.conversation_id, role: data.role, content, confirmed: false }),
    })
    setSkipped(true)
  }

  if (saved)   return <div>✓ Saved to Memory: {label}</div>
  if (skipped) return <div>— Skipped: {label} not saved to memory</div>

  return (
    <div className="confirm-card">
      <div className="confirm-title">Save to Memory: {label}</div>
      <div className="confirm-hint">You can edit before saving.</div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        disabled={!editing}
      />
      <div className="confirm-actions">
        <button onClick={save}>Save to Memory</button>
        <button onClick={() => setEditing(e => !e)}>{editing ? 'Done Editing' : 'Edit'}</button>
        <button onClick={skip}>Skip</button>
      </div>
    </div>
  )
}
```

---

## AssistantMessage — Rendering Cards

Each message has a `cards` array populated by `PUSH_CARD` actions. Render them below the text bubble.

```jsx
// components/chat/AssistantMessage.jsx
import { ValidationCard } from '../cards/ValidationCard'
import { ConfirmSaveCard } from '../cards/ConfirmSaveCard'
import { TracePanel } from '../cards/TracePanel'

export function AssistantMessage({ message }) {
  function downloadMd() {
    const blob = new Blob([message.text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `response-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="message assistant">
      <div className="bubble">{message.text}</div>
      <button onClick={downloadMd}>Download .md</button>
      {message.cards.map((card, i) => {
        if (card.type === 'validation')  return <ValidationCard key={i} data={card.data} />
        if (card.type === 'confirm_save') return <ConfirmSaveCard key={i} data={card.data} />
        if (card.type === 'trace')       return <TracePanel key={i} data={card.data} />
        return null
      })}
    </div>
  )
}
```

---

## AgentSwitcher — Reset Behavior

When the agent changes, clear files and reset conversation state via the reducer.

```jsx
// components/layout/AgentSwitcher.jsx
import { useChat } from '../../contexts/ChatContext'

const AGENTS = [
  { id: 'agent1', label: 'Intake & Fit' },
  { id: 'agent2', label: 'Resume' },
  { id: 'agent3', label: 'Interview' },
  { id: 'agent4', label: 'Validator' },
]

export function AgentSwitcher({ onAgentChange }) {
  const { state, dispatch } = useChat()

  function handleClick(agentId) {
    if (agentId === state.activeAgent) return
    dispatch({ type: 'SET_AGENT', agent: agentId })
    onAgentChange?.()   // caller passes clearFiles() from useFileAttachments
  }

  return (
    <div id="agent-switcher">
      {AGENTS.map(a => (
        <button
          key={a.id}
          className={state.activeAgent === a.id ? 'active' : ''}
          onClick={() => handleClick(a.id)}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
```

---

## MessageInput — Wiring It Together

```jsx
// components/input/MessageInput.jsx
import { useRef } from 'react'
import { useStream } from '../../hooks/useStream'
import { useAutoResize } from '../../hooks/useAutoResize'
import { useChat } from '../../contexts/ChatContext'
import { FileChip } from './FileChip'
import { UploadButton } from './UploadButton'

export function MessageInput({ fileAttachments }) {
  const { state } = useChat()
  const { sendMessage } = useStream()
  const textareaRef = useAutoResize()
  const { files, uploading, uploadFile, removeFile, consumeFiles } = fileAttachments

  function handleSubmit(e) {
    e.preventDefault()
    if (state.streaming) return
    const text = textareaRef.current.value.trim()
    if (!text) return

    const filePreambles = consumeFiles()
    const fullMessage = filePreambles.length
      ? filePreambles.map(t => `Here is an attached document:\n\n${t}`).join('\n\n') + `\n\n${text}`
      : text

    textareaRef.current.value = ''
    textareaRef.current.style.height = 'auto'
    sendMessage(state.activeAgent, state.conversationId, fullMessage)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div id="input-wrapper">
        {files.length > 0 && (
          <div id="file-chips">
            {files.map(f => (
              <FileChip key={f.id} name={f.name} onRemove={() => removeFile(f.id)} />
            ))}
          </div>
        )}
        <div id="input-row">
          <UploadButton disabled={state.streaming || uploading} onFiles={uploadFile} />
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Type a message..."
            disabled={state.streaming}
            onKeyDown={handleKeyDown}
          />
          <button type="submit" disabled={state.streaming}>
            {state.streaming ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </form>
  )
}
```

---

## App.jsx — Top-Level Wiring

```jsx
// App.jsx
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ChatProvider } from './contexts/ChatContext'
import { AuthScreen } from './components/auth/AuthScreen'
import { ChatLayout } from './components/layout/ChatLayout'

function Inner() {
  const { session } = useAuth()
  return session ? <ChatLayout /> : <AuthScreen />
}

export default function App() {
  return (
    <AuthProvider>
      <ChatProvider>
        <Inner />
      </ChatProvider>
    </AuthProvider>
  )
}
```

---

## Migration Gotchas

### 1. ScoreRing
The vanilla version mutates `strokeDashoffset` directly on a DOM element. Drive it from state as shown in the ScoreRing section above — React handles the DOM update.

### 2. ConfirmSaveCard textarea
The vanilla version calls `textarea.disabled = !textarea.disabled` imperatively. Use a `useState` boolean as shown above.

### 3. Streaming bubble
The vanilla version appends to `bubble.textContent` directly. In React, `APPEND_CHUNK` updates the last message's `text` in the reducer. `StreamingMessage` just renders `message.text` — React diffs and patches only the changed text node.

### 4. File chips reset on agent switch
`attachedFiles` is component-level state in `useFileAttachments`, not in the reducer. Pass `clearFiles` as the `onAgentChange` callback to `AgentSwitcher`.

### 5. conversationId reset on agent switch
Handled inside the `SET_AGENT` reducer case — `conversationId: crypto.randomUUID()`.

### 6. PANEL_UPDATE strip
The vanilla version runs a regex on `bubble.textContent` after `[DONE]`. In React this is the `FINALIZE_MSG` reducer case — strip before setting state, not after.

---

## Suggested Build Order

1. `lib/supabase.js` + `AuthContext` + `AuthScreen` — get login working first
2. `chatReducer` + `ChatContext` — define all actions before writing any UI
3. `useStream` — test against the real `/chat/:agent/stream` endpoint in isolation before wiring to UI
4. `ChatWindow` + `UserMessage` + `AssistantMessage` — render static messages
5. `MessageInput` + `useFileAttachments` + `useAutoResize`
6. `ProgressPanel` + `ScoreRing`
7. `ValidationCard`, `ConfirmSaveCard`, `TracePanel`
8. Wire `AgentSwitcher` reset behavior + `clearFiles` callback
9. Styling pass with Tailwind
