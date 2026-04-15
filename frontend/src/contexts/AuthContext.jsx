import { createContext, useContext, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = getSupabase()
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      console.log('[auth] user id:', s?.user?.id ?? 'logged out')
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signUp(email, password) {
    const { data, error } = await getSupabase().auth.signUp({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    await getSupabase().auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut, signUp }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
