import { useAuth as useClerkAuth, useUser } from '@clerk/react'

// AuthProvider is kept as a no-op so existing call sites in App.jsx don't break.
// Real auth state flows from ClerkProvider (mounted in main.jsx).
export function AuthProvider({ children }) {
  return children
}

export function useAuth() {
  const { isLoaded: authLoaded, isSignedIn, getToken, signOut, userId } = useClerkAuth()
  const { isLoaded: userLoaded, user } = useUser()
  return {
    isSignedIn: isSignedIn ?? false,
    isLoaded: authLoaded && userLoaded,
    getToken,
    signOut,
    userId,
    user,
  }
}
