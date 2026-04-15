import { useEffect, useRef } from 'react'

export function useAutoResize() {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    function resize() {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
    el.addEventListener('input', resize)
    return () => el.removeEventListener('input', resize)
  }, [])

  return ref
}
