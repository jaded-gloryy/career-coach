export function ValidationCard({ data }) {
  const verdict = data.verdict || (data.flags?.length ? 'needs-revision' : 'pass')

  const styles = {
    pass:           'bg-green-50 border-green-300 text-green-800',
    'needs-revision': 'bg-yellow-50 border-yellow-300 text-yellow-900',
    skipped:        'bg-slate-50 border-slate-300 text-slate-600',
    error:          'bg-red-50 border-red-300 text-red-800',
  }

  const labels = {
    pass:           '✓ Resume validation passed',
    'needs-revision': '⚠ Resume needs revision',
    skipped:        '— Validation skipped (no fact sheet)',
    error:          '✗ Validation error',
  }

  const cls = styles[verdict] || styles.skipped

  return (
    <div className={`mt-2 rounded-lg px-3.5 py-2.5 text-[0.8rem] border ${cls}`}>
      <div className="font-semibold mb-1.5">{labels[verdict] || verdict}</div>

      {data.message && (
        <div className="text-[0.75rem] opacity-80">{data.message}</div>
      )}

      {data.flags?.map((flag, i) => (
        <div key={i} className="mt-1.5 pt-1.5 border-t border-black/[0.08]">
          <div className="italic">{flag.claim}</div>
          {flag.issue && <div className="font-medium opacity-80 mt-0.5">{flag.issue}</div>}
          {flag.suggestion && <div className="text-[0.75rem] opacity-70 mt-0.5">{flag.suggestion}</div>}
        </div>
      ))}
    </div>
  )
}
