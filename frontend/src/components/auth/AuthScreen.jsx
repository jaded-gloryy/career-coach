import { useState } from 'react'
import { SignIn, Waitlist } from '@clerk/react'

export function AuthScreen() {
  const [tab, setTab] = useState('signin')

  const tabBase = 'px-5 py-2 text-sm font-medium rounded-full border-[1.5px] cursor-pointer transition-colors'
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

      {/* <div className="flex gap-2">
        <button
          type="button"
          className={`${tabBase} ${tab === 'signin' ? tabActive : tabInactive}`}
          onClick={() => setTab('signin')}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`${tabBase} ${tab === 'waitlist' ? tabActive : tabInactive}`}
          onClick={() => setTab('waitlist')}
        >
          Join Waitlist
        </button>
      </div> */}

      <div className="rounded-card shadow-[0_4px_24px_rgba(0,0,0,0.06)] overflow-hidden">
        {tab === 'signin' && (
          <SignIn
            fallbackRedirectUrl="/"
            signUpFallbackRedirectUrl="/"
            appearance={{
              variables: {
                colorPrimary: '#be185d',
                borderRadius: '0.5rem',
              },
            }}
          />
        )}
        {tab === 'waitlist' && (
          <Waitlist
            appearance={{
              variables: {
                colorPrimary: '#be185d',
                borderRadius: '0.5rem',
              },
            }}
          />
        )}
      </div>
    </div>
  )
}
