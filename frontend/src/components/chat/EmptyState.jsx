import { useState } from 'react'
import { useChat } from '../../contexts/ChatContext'

const AGENT_GREETINGS = {
  agent1: "Let's map out your career goals.",
  agent2: "Ready to make your resume shine.",
  agent3: "Let's prep you for that interview.",
  agent4: "Ready to validate your materials.",
}

const CATEGORIES = [
  {
    id: 'start',
    label: 'Get Started',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    prompts: [
      "I'm targeting a new role — help me get started",
      "What information do you need from me to begin?",
      "Walk me through the career coaching process",
      "I want to change industries — where do I start?",
    ],
  },
  {
    id: 'resume',
    label: 'Resume',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    prompts: [
      "Audit my resume for ATS compatibility",
      "Rewrite my weakest bullet points",
      "Help me quantify my impact with metrics",
      "Create a tailored version for this job description",
    ],
  },
  {
    id: 'interview',
    label: 'Interview',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    prompts: [
      "Generate role-specific interview questions for me",
      "Help me build STAR stories from my experience",
      "Start a mock interview session now",
      "What are my likely weak areas in interviews?",
    ],
  },
  {
    id: 'strategy',
    label: 'Career Strategy',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    prompts: [
      "What skills should I develop to be more competitive?",
      "How do I negotiate a higher salary offer?",
      "Help me plan a career pivot into a new field",
      "What's my strongest competitive edge right now?",
    ],
  },
]

export function EmptyState() {
  const { state, dispatch } = useChat()
  const [openCategory, setOpenCategory] = useState(null)

  const greeting = AGENT_GREETINGS[state.activeAgent] ?? "How can I help you today?"

  function selectPrompt(text) {
    dispatch({ type: 'SET_DRAFT', text })
    setOpenCategory(null)
  }

  function toggleCategory(id) {
    setOpenCategory(prev => (prev === id ? null : id))
  }

  const activeCat = CATEGORIES.find(c => c.id === openCategory)

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-10 gap-6">
      {/* Greeting */}
      <div className="text-center">
        <p className="font-serif text-[1.35rem] font-semibold text-brand-800 leading-snug">
          {greeting}
          <span className="inline-block w-[2px] h-[1.1em] bg-brand-400 ml-1 align-middle animate-[blink_1s_step-end_infinite]" />
        </p>
        <p className="mt-1.5 text-[0.82rem] text-gray-400">Choose a topic below or type your own message</p>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap justify-center gap-2">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => toggleCategory(cat.id)}
            className={[
              'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[0.8rem] font-medium transition-colors',
              openCategory === cat.id
                ? 'bg-brand-500 border-brand-500 text-white'
                : 'bg-white border-brand-200 text-brand-700 hover:bg-brand-50 hover:border-brand-400',
            ].join(' ')}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Expanded prompt list */}
      {activeCat && (
        <div className="w-full max-w-md bg-white border border-brand-100 rounded-2xl overflow-hidden shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-brand-50">
            <span className="flex items-center gap-2 text-[0.78rem] font-semibold text-brand-600 uppercase tracking-wide">
              {activeCat.icon}
              {activeCat.label}
            </span>
            <button
              onClick={() => setOpenCategory(null)}
              className="text-gray-300 hover:text-gray-500 transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Prompt rows */}
          {activeCat.prompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => selectPrompt(prompt)}
              className="w-full text-left px-4 py-3 text-[0.875rem] text-gray-700 hover:bg-brand-50 flex items-center justify-between group transition-colors border-b border-gray-50 last:border-0"
            >
              <span>{prompt}</span>
              <svg
                className="w-4 h-4 text-gray-300 group-hover:text-brand-400 transition-colors flex-shrink-0 ml-2"
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
