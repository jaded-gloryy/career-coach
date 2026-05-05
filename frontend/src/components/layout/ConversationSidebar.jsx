import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'

function formatRelativeTime(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHrs = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHrs < 24) return `${diffHrs}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function truncate(text, maxLen = 60) {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text
}

function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/\*{1,3}(.+?)\*{1,3}/g, '$1') // bold/italic
    .replace(/_{1,3}(.+?)_{1,3}/g, '$1')   // underscore bold/italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')     // inline code / code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // images
    .replace(/^[-*_]{3,}\s*$/gm, '')        // hr
    .replace(/\n+/g, ' ')
    .trim()
}

function getPreview(conv) {
  const rawTitle = conv.title || null
  const rawMessage = conv.last_message || ''

  // If the message starts with a markdown heading, use it as the title
  const headingMatch = rawMessage.match(/^#{1,6}\s+(.+?)(?:\n|$)/)
  const extractedTitle = headingMatch ? headingMatch[1].trim() : null

  const title = rawTitle || extractedTitle || null
  const bodyText = headingMatch
    ? rawMessage.slice(headingMatch[0].length)
    : rawMessage

  const snippet = bodyText ? truncate(stripMarkdown(bodyText)) : null

  return { title, snippet }
}

export function ConversationSidebar({ conversations, loading, onConversationLoad }) {
  const { getToken } = useAuth()
  const { state, dispatch } = useChat()
  const [loadingId, setLoadingId] = useState(null)

  async function handleSelect(conv) {
    if (conv.id === state.conversationId) return
    setLoadingId(conv.id)
    try {
      const token = await getToken()
      const res = await fetch(`/chat/conversations/${conv.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      console.log('Fetch messages response: ', res)
      if (!res.ok) return
      const data = await res.json()        
      console.log('conversation data:', data)  // add this 
      dispatch({ type: 'LOAD_CONVERSATION', conversationId: conv.id, messages: data.messages, panelState: data.panel_state ?? null })
      onConversationLoad?.()
    } finally {
      setLoadingId(null)
    }
  }

  function handleNew() {
    dispatch({ type: 'NEW_CONVERSATION' })
  }

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-pink-100 flex flex-col h-screen sticky top-0">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 border-b border-pink-50">
        <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-pink-400 mb-3">
          Conversations
        </p>
        <button
          onClick={handleNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-pink-600 bg-pink-50 hover:bg-pink-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New chat
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="px-4 py-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-4 py-6 text-xs text-gray-400 text-center">No conversations yet</p>
        ) : (
          conversations.map(conv => {
            const isActive = conv.id === state.conversationId
            const isLoading = loadingId === conv.id
            return (
              <button
                key={conv.id}
                onClick={() => handleSelect(conv)}
                disabled={isLoading}
                className={`w-full text-left px-4 py-2.5 flex flex-col gap-1 transition-colors ${
                  isActive
                    ? 'bg-pink-50 border-r-2 border-pink-400'
                    : 'hover:bg-gray-50'
                }`}
              >
                {isLoading ? (
                  <span className="text-[0.8rem] text-pink-400">Loading…</span>
                ) : (() => {
                  const { title, snippet } = getPreview(conv)
                  return (
                    <>
                      <span className={`text-[0.8rem] font-semibold leading-snug truncate ${
                        isActive ? 'text-pink-700' : 'text-gray-800'
                      }`}>
                        {title || snippet || 'New conversation'}
                      </span>
                      {title && snippet && (
                        <span className="text-[0.72rem] leading-snug line-clamp-1 text-gray-500">
                          {snippet}
                        </span>
                      )}
                    </>
                  )
                })()}
                <span className="text-[0.68rem] text-gray-400">
                  {formatRelativeTime(conv.last_message_at || conv.created_at)}
                </span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
