import { useRef } from 'react'

export function UploadButton({ disabled, onFiles }) {
  const inputRef = useRef(null)

  function handleChange(e) {
    const files = Array.from(e.target.files)
    e.target.value = ''
    files.forEach(onFiles)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".txt,.rtf,.json,.md,.docx,.pdf"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && inputRef.current.click()}
        title="Attach files"
        aria-label="Attach files"
        className="flex-shrink-0 w-8 h-8 rounded-full border-[1.5px] border-brand-200 bg-white text-brand-500 flex items-center justify-center hover:bg-[var(--brand-50)] hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer p-0"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="7" y1="1" x2="7" y2="13"/>
          <line x1="1" y1="7" x2="13" y2="7"/>
        </svg>
      </button>
    </>
  )
}
