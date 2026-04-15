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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        conversation_id: data.conversation_id,
        role: data.role,
        content,
        confirmed: true,
      }),
    })
    setSaved(true)
  }

  async function skip() {
    await fetch('/chat/confirm-save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        conversation_id: data.conversation_id,
        role: data.role,
        content,
        confirmed: false,
      }),
    })
    setSkipped(true)
  }

  if (saved) return (
    <div className="mt-2 text-[0.8rem] text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
      ✓ Saved to Memory: {label}
    </div>
  )

  if (skipped) return (
    <div className="mt-2 text-[0.8rem] text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      — Skipped: {label} not saved to memory
    </div>
  )

  return (
    <div className="mt-2 border-[1.5px] border-brand-200 rounded-lg p-4 bg-brand-50 text-[0.82rem]">
      <div className="font-semibold text-brand-700 mb-2">Save to Memory: {label}</div>
      <div className="text-[0.72rem] text-gray-400 mb-2.5">You can edit before saving.</div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        disabled={!editing}
        className="w-full min-h-[80px] max-h-[240px] p-2 border border-brand-200 rounded-md text-[0.78rem] font-sans resize-y bg-white text-gray-800 mb-2 disabled:opacity-60"
      />
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={save}
          className="text-[0.75rem] font-medium px-3.5 py-1.5 rounded-full border-[1.5px] bg-brand-500 border-brand-500 text-white hover:bg-brand-600 hover:border-brand-600 cursor-pointer transition-colors"
        >
          Save to Memory
        </button>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-[0.75rem] font-medium px-3.5 py-1.5 rounded-full border-[1.5px] bg-white border-brand-200 text-brand-600 hover:bg-brand-50 cursor-pointer transition-colors"
        >
          {editing ? 'Done Editing' : 'Edit'}
        </button>
        <button
          onClick={skip}
          className="text-[0.75rem] font-medium px-3.5 py-1.5 rounded-full border-[1.5px] bg-white border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
