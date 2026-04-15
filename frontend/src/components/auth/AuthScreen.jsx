import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

export function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [tab, setTab] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  function switchTab(t) {
    setTab(t)
    setError('')
    setSuccess('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (tab === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    try {
      if (tab === 'signin') {
        await signIn(email, password)
      } else {
        const data = await signUp(email, password)
        if (!data.session) {
          setSuccess('Account created! Check your email to confirm before signing in.')
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const tabBase = 'flex-1 py-2 text-sm font-medium rounded-full border-[1.5px] cursor-pointer transition-colors'
  const tabActive = 'bg-brand-500 border-brand-500 text-white'
  const tabInactive = 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50'

  return (
    <div className="fixed inset-0 bg-[var(--bg-base)] z-50 flex items-center justify-center flex-col gap-6">
      <div className="text-center">
        <h1 className="font-serif font-semibold text-[2rem] text-brand-700 tracking-tight leading-none">
          Career Coach
        </h1>
        <p className="mt-1.5 text-sm text-gray-400">Your multi-agent career coaching assistant</p>
      </div>

      <div className="bg-white p-8 rounded-card w-[360px] shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-brand-100">
        <div className="flex gap-2 mb-6">
          <button
            type="button"
            className={`${tabBase} ${tab === 'signin' ? tabActive : tabInactive}`}
            onClick={() => switchTab('signin')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`${tabBase} ${tab === 'signup' ? tabActive : tabInactive}`}
            onClick={() => switchTab('signup')}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            required
            className="w-full mb-3 px-3.5 py-2 bg-white border-[1.5px] border-brand-200 text-gray-800 rounded-lg text-sm font-sans outline-none transition-colors focus:border-brand-400"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
            onKeyDown={e => e.key === 'Enter' && handleSubmit(e)}
            className="w-full mb-4 px-3.5 py-2 bg-white border-[1.5px] border-brand-200 text-gray-800 rounded-lg text-sm font-sans outline-none transition-colors focus:border-brand-400"
          />

          {error && (
            <div className="mb-3 text-[0.82rem] text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-3 text-[0.82rem] text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-200 text-white border-none rounded-full text-sm font-medium cursor-pointer transition-colors"
          >
            {loading
              ? (tab === 'signin' ? 'Signing in…' : 'Creating account…')
              : (tab === 'signin' ? 'Sign In' : 'Create Account')}
          </button>
        </form>
      </div>
    </div>
  )
}
