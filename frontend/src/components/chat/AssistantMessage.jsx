import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ValidationCard } from '../cards/ValidationCard'
import { ConfirmSaveCard } from '../cards/ConfirmSaveCard'
import { TracePanel } from '../cards/TracePanel'

const mdComponents = {
  h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1 text-gray-900">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1 text-gray-900">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-0.5 text-gray-800">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.6]">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.6]">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ inline, children }) =>
    inline
      ? <code className="px-1 py-0.5 rounded bg-brand-50 text-brand-700 text-[0.82em] font-mono border border-brand-100">{children}</code>
      : <pre className="my-2 p-3 rounded-lg bg-gray-50 border border-gray-200 overflow-x-auto text-[0.82em] font-mono leading-relaxed"><code>{children}</code></pre>,
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-brand-300 pl-3 my-2 text-gray-600 italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-brand-100" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-800">
      {children}
    </a>
  ),
}

export function AssistantMessage({ message }) {
  function downloadMd() {
    const blob = new Blob([message.text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `response-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col max-w-[82%] self-start items-start">
      <div className="px-4 py-3 rounded-card rounded-bl-[3px] bg-brand-50 text-gray-800 border border-brand-100 text-[0.9rem]">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {message.text}
        </ReactMarkdown>
      </div>

      {message.text && (
        <button
          onClick={downloadMd}
          title="Download as Markdown"
          className="mt-1 p-1.5 rounded-full text-gray-300 hover:text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}

      {message.cards.map((card, i) => {
        if (card.type === 'validation')   return <ValidationCard  key={i} data={card.data} />
        if (card.type === 'confirm_save') return <ConfirmSaveCard key={i} data={card.data} />
        if (card.type === 'trace')        return <TracePanel      key={i} data={card.data} />
        return null
      })}
    </div>
  )
}
