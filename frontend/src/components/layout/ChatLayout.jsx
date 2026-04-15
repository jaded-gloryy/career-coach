import { useEffect } from 'react'
import { useChat } from '../../contexts/ChatContext'
import { useFileAttachments } from '../../hooks/useFileAttachments'
import { useConversations } from '../../hooks/useConversations'
import { Sidebar } from './Sidebar'
import { ProgressPanel } from './ProgressPanel'
import { AgentSwitcher } from './AgentSwitcher'
import { ChatWindow } from '../chat/ChatWindow'
import { EmptyState } from '../chat/EmptyState'
import { MessageInput } from '../input/MessageInput'

export function ChatLayout() {
  const { state } = useChat()
  const fileAttachments = useFileAttachments()
  const { conversations, loading, refetch } = useConversations()

  const showLanding = state.messages.length === 0 && !state.streaming
  const showProgress = !showLanding && !!state.panelState?.jobTitle

  useEffect(() => {
    if (!state.streaming) refetch()
  }, [state.streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)]">
      <Sidebar
        conversations={conversations}
        loading={loading}
        onConversationLoad={refetch}
      />

      {showLanding ? (
        /* ── Landing page ── */
        <div className="flex flex-col flex-1 items-center justify-center px-4 py-8 min-w-0 min-h-screen">
          <div className="w-full max-w-[680px] flex flex-col gap-4">
            <EmptyState />
            <div className="bg-white rounded-card shadow-[0_4px_24px_rgba(0,0,0,0.06)] overflow-hidden border border-brand-100">
              <MessageInput fileAttachments={fileAttachments} />
            </div>
          </div>
        </div>
      ) : (
        /* ── Chat view ── */
        <div className="flex flex-col flex-1 items-center px-4 py-8 overflow-y-auto min-w-0">
          <div className="w-full max-w-[720px]">
            {showProgress && <ProgressPanel />}
            <div className="bg-white rounded-card shadow-[0_4px_24px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col border border-brand-100">
              <AgentSwitcher onAgentChange={fileAttachments.clearFiles} />
              <ChatWindow />
              <MessageInput fileAttachments={fileAttachments} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
