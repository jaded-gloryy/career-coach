export function UserMessage({ message }) {
  return (
    <div className="flex flex-col max-w-[82%] self-end items-end">
      <div className="px-4 py-2.5 rounded-card rounded-br-[3px] bg-brand-500 text-white text-[0.9rem] leading-[1.55] whitespace-pre-wrap break-words">
        {message.text}
      </div>
    </div>
  )
}
