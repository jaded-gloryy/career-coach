import { useChat } from '../../contexts/ChatContext'

const CIRCUMFERENCE = 150.8

function ScoreRing({ score }) {
  const offset = score !== null
    ? CIRCUMFERENCE * (1 - Math.min(100, score) / 100)
    : CIRCUMFERENCE

  const color = score === null ? '#e5e5e5'
    : score >= 75 ? '#22c55e'
    : score >= 50 ? '#f59e0b'
    : '#ef4444'

  return (
    <div className="relative w-14 h-14">
      <svg viewBox="0 0 60 60" className="w-14 h-14 -rotate-90">
        <circle cx="30" cy="30" r="24" fill="none" stroke="var(--brand-100)" strokeWidth="5" />
        <circle
          cx="30" cy="30" r="24" fill="none"
          strokeWidth="5"
          className="score-ring-fill"
          style={{ stroke: color, strokeDashoffset: offset }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[0.8rem] font-semibold text-gray-800">
        {score ?? '—'}
      </div>
    </div>
  )
}

export function ProgressPanel() {
  const { state, AGENT_LABELS } = useChat()
  const { panelState, activeAgent } = state

  return (
    <div className="border border-brand-100 bg-gray-50 text-[0.8rem] mb-8 rounded-card shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center px-5 py-2.5 border-b border-brand-100 text-gray-600 gap-4 flex-wrap">
        <span>
          Active Agent:{' '}
          <strong className="text-gray-800 font-semibold">
            {AGENT_LABELS[activeAgent] || activeAgent}
          </strong>
        </span>
        <span>
          Job Title:{' '}
          <strong className="text-gray-800 font-semibold">
            {panelState.jobTitle || 'Not yet determined'}
          </strong>
        </span>
      </div>
      <div className="grid grid-cols-[140px_1fr]">
        <div className="flex flex-col items-center justify-center gap-1 px-4 py-3 border-r border-brand-100">
          <ScoreRing score={panelState.jobFitScore} />
          <div className="text-[0.7rem] text-gray-400 text-center">Job Fit Score</div>
        </div>
        <div className="flex flex-col justify-center gap-1.5 px-5 py-3">
          <div className="text-[0.7rem] text-gray-400 uppercase tracking-[0.04em]">Session Summary</div>
          <div className="text-gray-600 leading-[1.4]">
            {panelState.lastAction || 'No actions yet'}
          </div>
          {panelState.sectionsModified !== null && (
            <div className="text-gray-600 leading-[1.4]">
              {panelState.sectionsModified} section{panelState.sectionsModified !== 1 ? 's' : ''} revised
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
