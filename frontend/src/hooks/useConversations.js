import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function useConversations() {
  const { isSignedIn, getToken } = useAuth()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchConversations = useCallback(async () => {
    if (!isSignedIn) return
    try {
      const token = await getToken()
      const res = await fetch('/chat/conversations', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setConversations(data.conversations || [])
    } catch {
      // Silently ignore network errors; sidebar is non-critical
    } finally {
      setLoading(false)
    }
  }, [isSignedIn, getToken])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  return { conversations, loading, refetch: fetchConversations }
}
