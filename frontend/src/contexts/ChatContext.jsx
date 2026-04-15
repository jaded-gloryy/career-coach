import { createContext, useContext, useReducer } from 'react'

const AGENT_LABELS = {
  agent1: 'Intake & Fit',
  agent2: 'Resume Coach',
  agent3: 'Interview Coach',
  agent4: 'Validator',
}

const initialState = {
  activeAgent: 'agent1',
  conversationId: crypto.randomUUID(),
  messages: [],
  streaming: false,
  inputDraft: '',
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
          ...(action.data.job_title      != null && { jobTitle: action.data.job_title }),
          ...(action.data.last_action    != null && { lastAction: action.data.last_action }),
          ...(action.data.sections_modified != null && { sectionsModified: action.data.sections_modified }),
        },
      }

    case 'SET_STREAMING':
      return { ...state, streaming: action.streaming }

    case 'NEW_CONVERSATION':
      return {
        ...state,
        conversationId: crypto.randomUUID(),
        messages: [],
        streaming: false,
        panelState: {
          jobFitScore: null,
          jobTitle: null,
          lastAction: null,
          sectionsModified: null,
        },
      }

    case 'LOAD_CONVERSATION': {
      const stored = action.panelState
      const lastAgentMsg = [...action.messages].reverse().find(m => m.agent_id != null)
      const restoredAgent = lastAgentMsg ? `agent${lastAgentMsg.agent_id}` : state.activeAgent
      return {
        ...state,
        conversationId: action.conversationId,
        activeAgent: restoredAgent,
        messages: action.messages.map(m => ({
          id: crypto.randomUUID(),
          role: m.role,
          text: m.content,
          cards: [],
        })),
        streaming: false,
        panelState: stored
          ? {
              jobFitScore:      stored.job_fit_score      ?? null,
              jobTitle:         stored.job_title          ?? null,
              lastAction:       stored.last_action        ?? null,
              sectionsModified: stored.sections_modified  ?? null,
            }
          : { jobFitScore: null, jobTitle: null, lastAction: null, sectionsModified: null },
      }
    }

    case 'SET_DRAFT':
      return { ...state, inputDraft: action.text }

    case 'CLEAR_DRAFT':
      return { ...state, inputDraft: '' }

    default:
      return state
  }
}

const ChatContext = createContext()

export function ChatProvider({ children }) {
  const [state, dispatch] = useReducer(chatReducer, initialState)
  return (
    <ChatContext.Provider value={{ state, dispatch, AGENT_LABELS }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChat = () => useContext(ChatContext)
