import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ChatProvider } from './contexts/ChatContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthScreen } from './components/auth/AuthScreen'
import { ChatLayout } from './components/layout/ChatLayout'

function Inner() {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? <ChatLayout /> : <AuthScreen />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ChatProvider>
          <Inner />
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
