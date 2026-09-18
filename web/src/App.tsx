import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { LoginScreen } from './components/LoginScreen'
import { Dashboard } from './components/Dashboard'
import { ResetPasswordScreen } from './components/ResetPasswordScreen'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })

    // An invalid/expired reset link doesn't fire an auth event at all —
    // Supabase appends error params to the URL fragment instead
    // (#error=access_denied&error_code=otp_expired&error_description=...).
    // Without reading this, the link silently drops the user on a blank
    // sign-in page with no explanation of what happened.
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const description = hashParams.get('error_description')
    if (description) {
      setLinkError(description.replace(/\+/g, ' '))
      // Clear it so refreshing doesn't keep re-showing a stale error.
      window.history.replaceState(null, '', window.location.pathname)
    }

    // PASSWORD_RECOVERY fires once, right after detectSessionInUrl parses a
    // password-reset link's tokens out of the URL — see LoginScreen's
    // "Forgot password?" flow and ResetPasswordScreen's docstring.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
      }
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  if (checkingSession) {
    return <div className="centered">Loading…</div>
  }

  if (recoveryMode) {
    return <ResetPasswordScreen onDone={() => setRecoveryMode(false)} />
  }

  return session ? <Dashboard myUserId={session.user.id} /> : <LoginScreen initialError={linkError} />
}

export default App
