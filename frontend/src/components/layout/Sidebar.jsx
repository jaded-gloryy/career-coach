import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { useTheme } from '../../contexts/ThemeContext'

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
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}(.+?)\*{1,3}/g, '$1')
    .replace(/_{1,3}(.+?)_{1,3}/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
}

function getPreview(conv) {
  const rawTitle = conv.title || null
  const rawMessage = conv.last_message || ''
  const headingMatch = rawMessage.match(/^#{1,6}\s+(.+?)(?:\n|$)/)
  const extractedTitle = headingMatch ? headingMatch[1].trim() : null
  const title = rawTitle || extractedTitle || null
  const bodyText = headingMatch ? rawMessage.slice(headingMatch[0].length) : rawMessage
  const snippet = bodyText ? truncate(stripMarkdown(bodyText)) : null
  return { title, snippet }
}

export function Sidebar({ conversations, loading, onConversationLoad }) {
  const [open, setOpen] = useState(true)
  const [loadingId, setLoadingId] = useState(null)
  const { signOut, getToken, user } = useAuth()
  const { state, dispatch } = useChat()
  const { theme, setTheme, themes } = useTheme()

  const userEmail = user?.emailAddresses?.[0]?.emailAddress
  const userInitial = userEmail?.[0]?.toUpperCase() ?? 'U'

  async function handleSelect(conv) {
    if (conv.id === state.conversationId) return
    setLoadingId(conv.id)
    try {
      const token = await getToken()
      const res = await fetch(`/chat/conversations/${conv.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
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
    <aside
      className={`${open ? 'w-64' : 'w-16'} shrink-0 bg-white border-r border-brand-100 flex flex-col h-screen sticky top-0 transition-all duration-300 overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-brand-50 min-h-[57px]">
        {open ? (
          <>
            <span className="font-serif font-semibold text-brand-700 text-[1.05rem] truncate pl-1">
              Career Coach
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-brand-300 hover:text-brand-500 transition-colors p-1.5 rounded-lg hover:bg-brand-50 flex-shrink-0"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="w-full flex items-center justify-center text-brand-400 hover:text-brand-600 transition-colors p-1.5 rounded-lg hover:bg-brand-50"
            title="Expand sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
      </div>

      {/* New chat */}
      <div className="px-2 py-3 border-b border-brand-50">
        <button
          onClick={handleNew}
          className={`w-full flex items-center ${open ? 'gap-2 px-3' : 'justify-center'} py-2 rounded-lg text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors`}
          title={!open ? 'New chat' : undefined}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {open && <span>New chat</span>}
        </button>
      </div>

      {/* Conversation list */}
      {open ? (
        <div className="flex-1 overflow-y-auto py-2">
          {open && (
            <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-brand-300 px-4 pb-2">
              Conversations
            </p>
          )}
          {loading ? (
            <div className="px-3 py-2 space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-11 rounded-lg bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-4 text-xs text-gray-400 text-center">No conversations yet</p>
          ) : (
            conversations.map(conv => {
              const isActive = conv.id === state.conversationId
              const isLoading = loadingId === conv.id
              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelect(conv)}
                  disabled={isLoading}
                  className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors ${
                    isActive
                      ? 'bg-brand-50 border-r-2 border-brand-400'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {isLoading ? (
                    <span className="text-[0.8rem] text-brand-400">Loading…</span>
                  ) : (() => {
                    const { title, snippet } = getPreview(conv)
                    return (
                      <>
                        <span className={`text-[0.8rem] font-semibold leading-snug truncate ${
                          isActive ? 'text-brand-700' : 'text-gray-800'
                        }`}>
                          {title || snippet || 'New conversation'}
                        </span>
                        {title && snippet && (
                          <span className="text-[0.72rem] leading-snug line-clamp-1 text-gray-500">
                            {snippet}
                          </span>
                        )}
                        <span className="text-[0.65rem] text-gray-400">
                          {formatRelativeTime(conv.last_message_at || conv.created_at)}
                        </span>
                      </>
                    )
                  })()}
                </button>
              )
            })
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Bottom: theme + sign out */}
      <div className="border-t border-brand-50 px-2 py-3 flex flex-col gap-1">
        {/* Theme picker */}
        <div className={`flex items-center ${open ? 'gap-2 px-2 py-1' : 'flex-col gap-2 items-center py-1'}`}>
          {themes.map(t => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              title={t.label}
              className={`w-4 h-4 rounded-full flex-shrink-0 transition-all ${
                theme === t.id
                  ? 'ring-2 ring-offset-1 ring-gray-400 scale-110'
                  : 'opacity-60 hover:opacity-100 hover:scale-110'
              }`}
              style={{ backgroundColor: t.swatch }}
            />
          ))}
          {open && <span className="text-[0.7rem] text-gray-400 ml-1">Theme</span>}
        </div>

        {/* Sign out */}
        <button
          onClick={signOut}
          className={`flex items-center ${open ? 'gap-2 px-3 py-2' : 'justify-center py-2'} rounded-lg text-[0.82rem] text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors`}
          title={!open ? 'Sign out' : undefined}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {open && <span>Sign out</span>}
        </button>

        {/* User avatar */}
        {open && (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="w-6 h-6 rounded-full bg-brand-500 text-white text-[0.65rem] font-semibold flex items-center justify-center flex-shrink-0">
              {userInitial}
            </div>
            <span className="text-[0.75rem] text-gray-500 truncate">{userEmail}</span>
          </div>
        )}
        {!open && (
          <div className="flex justify-center py-1">
            <div className="w-6 h-6 rounded-full bg-brand-500 text-white text-[0.65rem] font-semibold flex items-center justify-center">
              {userInitial}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
