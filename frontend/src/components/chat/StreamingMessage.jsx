import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

export function StreamingMessage({ message }) {
  return (
    <div className="flex flex-col max-w-[82%] self-start items-start">
      <div className="px-4 py-3 rounded-card rounded-bl-[3px] bg-brand-50 text-gray-800 border border-brand-100 text-[0.9rem]">
        {message.text
          ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {message.text}
            </ReactMarkdown>
          )
          : <span className="animate-pulse text-gray-400">▌</span>
        }
      </div>
    </div>
  )
}
