export function TracePanel({ data }) {
  const ctxClass = data.context_injected ? 'text-green-600' : 'text-red-600'
  const ctxLabel = data.context_injected ? '✓ injected' : '✗ not injected'

  return (
    <details className="trace-panel mt-1.5 border border-slate-200 rounded-lg text-[0.75rem] font-mono bg-slate-50 overflow-hidden">
      <summary className="px-3 py-1.5 cursor-pointer text-slate-500 select-none">
        ▸ Trace: {data.agent_id} · {data.model || '—'} · {data.latency_ms != null ? `${data.latency_ms}ms` : '—'} · ~{data.token_count_approx ?? '?'} tokens
      </summary>
      <div className="p-2.5 flex flex-col gap-2 border-t border-slate-200">
        <TraceSection title="Agent">
          {data.agent_id} — history: {data.history_message_count} msgs
        </TraceSection>
        <TraceSection title="Context">
          <span className={ctxClass}>{ctxLabel}</span>
          {data.system_prompt_length != null && ` · prompt: ${data.system_prompt_length} chars`}
        </TraceSection>
        {data.validation_result && (
          <TraceSection title="Validation">
            {data.validation_result}
          </TraceSection>
        )}
        {data.validation_error && (
          <TraceSection title="Validation Error">
            <span className="text-red-600">{data.validation_error}</span>
          </TraceSection>
        )}
        {data.system_prompt_preview && (
          <TraceSection title="System Prompt Preview">
            <pre className="whitespace-pre-wrap break-words text-slate-700 leading-snug m-0">
              {data.system_prompt_preview}
            </pre>
          </TraceSection>
        )}
        {data.errors?.length > 0 && (
          <TraceSection title="Errors">
            {data.errors.map((e, i) => (
              <div key={i} className="text-red-600">{e}</div>
            ))}
          </TraceSection>
        )}
      </div>
    </details>
  )
}

function TraceSection({ title, children }) {
  return (
    <div>
      <h4 className="text-[0.65rem] uppercase tracking-widest text-slate-400 mb-1 font-sans">
        {title}
      </h4>
      <div className="text-slate-700 leading-snug">{children}</div>
    </div>
  )
}
