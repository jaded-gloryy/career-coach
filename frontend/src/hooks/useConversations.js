import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function useConversations() {
  const { session } = useAuth()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchConversations = useCallback(async () => {
    if (!session) return
    try {
      const res = await fetch('/chat/conversations', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setConversations(data.conversations || [])
    } catch {
      // Silently ignore network errors; sidebar is non-critical
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  return { conversations, loading, refetch: fetchConversations }
}
