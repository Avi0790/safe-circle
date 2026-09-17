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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })

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

  return session ? <Dashboard /> : <LoginScreen />
}

export default App
