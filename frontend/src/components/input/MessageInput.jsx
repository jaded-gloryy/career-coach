import { useEffect } from 'react'
import { useStream } from '../../hooks/useStream'
import { useAutoResize } from '../../hooks/useAutoResize'
import { useChat } from '../../contexts/ChatContext'
import { FileChip } from './FileChip'
import { UploadButton } from './UploadButton'

export function MessageInput({ fileAttachments }) {
  const { state, dispatch } = useChat()
  const { sendMessage } = useStream()
  const textareaRef = useAutoResize()

  // Consume inputDraft: fill textarea and focus when a prompt chip is selected
  useEffect(() => {
    if (!state.inputDraft) return
    const ta = textareaRef.current
    if (!ta) return
    ta.value = state.inputDraft
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    dispatch({ type: 'CLEAR_DRAFT' })
  }, [state.inputDraft]) // eslint-disable-line react-hooks/exhaustive-deps
  const { files, uploading, uploadFile, removeFile, consumeFiles } = fileAttachments

  function handleSubmit(e) {
    e.preventDefault()
    if (state.streaming) return
    const text = textareaRef.current.value.trim()
    if (!text) return

    const filePreambles = consumeFiles()
    const fullMessage = filePreambles.length
      ? filePreambles.map(t => `Here is an attached document:\n\n${t}`).join('\n\n') + `\n\n${text}`
      : text

    textareaRef.current.value = ''
    textareaRef.current.style.height = 'auto'
    sendMessage(state.activeAgent, state.conversationId, fullMessage)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-3.5 border-t border-brand-100 bg-gray-50">
      <div className="flex flex-col border-[1.5px] border-brand-200 rounded-2xl bg-white focus-within:border-brand-400 transition-colors overflow-hidden">
        {(files.length > 0 || uploading) && (
          <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1 border-b border-brand-100">
            {files.map(f => (
              <FileChip key={f.id} name={f.name} onRemove={() => removeFile(f.id)} />
            ))}
            {uploading && <FileChip loading />}
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <UploadButton disabled={state.streaming || uploading} onFiles={uploadFile} />
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Type a message…"
            disabled={state.streaming}
            onKeyDown={handleKeyDown}
            className="flex-1 font-sans text-[0.9rem] border-none outline-none bg-transparent text-gray-800 resize-none overflow-y-hidden max-h-40 leading-[1.5] pt-0.5 min-w-0 placeholder:text-gray-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={state.streaming}
            className="flex-shrink-0 font-sans text-[0.875rem] font-medium px-4 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-200 text-white border-none rounded-full cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
          >
            {state.streaming ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </form>
  )
}
