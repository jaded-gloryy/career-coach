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
    onAgentChange?.()
  }

  return (
    <div className="flex gap-2 px-5 py-4 border-b border-brand-100 bg-brand-50 flex-wrap">
      {AGENTS.map(a => (
        <button
          key={a.id}
          onClick={() => handleClick(a.id)}
          className={[
            'font-sans text-[0.8rem] font-medium px-4 py-1.5 rounded-full border-[1.5px] cursor-pointer transition-colors',
            state.activeAgent === a.id
              ? 'bg-brand-500 border-brand-500 text-white'
              : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-100 hover:border-brand-400',
          ].join(' ')}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
