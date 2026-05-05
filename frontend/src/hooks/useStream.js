import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../contexts/ChatContext'

export function useStream() {
  const { getToken } = useAuth()
  const { dispatch } = useChat()

  async function sendMessage(agentId, conversationId, message) {
    dispatch({ type: 'SET_STREAMING', streaming: true })
    dispatch({ type: 'PUSH_MSG', role: 'user', text: message })
    dispatch({ type: 'PUSH_MSG', role: 'assistant', text: '' })

    const token = await getToken()
    const res = await fetch(`/chat/${agentId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
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
