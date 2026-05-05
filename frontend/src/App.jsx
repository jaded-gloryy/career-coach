import { useAuth } from './contexts/AuthContext'
import { ChatProvider } from './contexts/ChatContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthScreen } from './components/auth/AuthScreen'
import { ChatLayout } from './components/layout/ChatLayout'

function Inner() {
  const { isSignedIn, isLoaded } = useAuth()
  if (!isLoaded) return null
  return isSignedIn ? <ChatLayout /> : <AuthScreen />
}

export default function App() {
  return (
    <ThemeProvider>
      <ChatProvider>
        <Inner />
      </ChatProvider>
    </ThemeProvider>
  )
}
