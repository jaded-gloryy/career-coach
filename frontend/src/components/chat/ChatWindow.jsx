import { useEffect, useRef } from 'react'
import { useChat } from '../../contexts/ChatContext'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { StreamingMessage } from './StreamingMessage'

export function ChatWindow() {
  const { state } = useChat()
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages])

  return (
    <div className="flex-1 min-h-[420px] max-h-[520px] overflow-y-auto chat-scroll p-6 flex flex-col gap-4">
      {state.messages.map((msg, i) => {
        if (msg.role === 'user') return <UserMessage key={msg.id} message={msg} />
        const isStreaming = state.streaming && i === state.messages.length - 1
        if (isStreaming) return <StreamingMessage key={msg.id} message={msg} />
        return <AssistantMessage key={msg.id} message={msg} />
      })}
      <div ref={bottomRef} />
    </div>
  )
}
