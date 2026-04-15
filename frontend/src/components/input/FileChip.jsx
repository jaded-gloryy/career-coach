export function FileChip({ name, onRemove, loading }) {
  if (loading) {
    return (
      <div className="skeleton-chip inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.75rem] font-medium max-w-[200px]">
        uploading…
      </div>
    )
  }

  return (
    <div
      className="group inline-flex items-center gap-1 px-2.5 py-1 bg-brand-100 text-brand-700 rounded-full text-[0.75rem] font-medium max-w-[200px] cursor-pointer hover:bg-brand-200 transition-colors"
      onClick={onRemove}
      title="Click to remove"
    >
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
      <span className="flex-shrink-0 w-3.5 h-3.5 rounded-full bg-brand-400 text-white text-[0.65rem] leading-[14px] text-center opacity-0 group-hover:opacity-100 transition-opacity">
        ×
      </span>
    </div>
  )
}
