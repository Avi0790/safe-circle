import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'forgot' | 'sent'

export function LoginScreen({ initialError = null }: { initialError?: string | null }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)

  async function handleSignIn(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    // redirectTo: back to this same page — App.tsx's PASSWORD_RECOVERY
    // handler swaps in ResetPasswordScreen once the browser client parses
    // the tokens out of the URL (detectSessionInUrl is on by default here,
    // unlike the mobile client — see ResetPasswordScreen's docstring).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setMode('sent')
  }

  if (mode === 'sent') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Check your email</h1>
          <p className="subtitle">
            We sent a password reset link to {email}. Open it on this device to set a new
            password.
          </p>
          <button type="button" onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'forgot') {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleForgotPassword}>
          <h1>Reset your password</h1>
          <p className="subtitle">Enter your email and we'll send you a reset link.</p>

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
          <button type="button" className="link-button" onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSignIn}>
        <h1>Safe Circle</h1>
        <p className="subtitle">Web dashboard &mdash; view only</p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <button type="button" className="link-button" onClick={() => setMode('forgot')}>
          Forgot password?
        </button>

        <p className="hint">
          Use the same account you signed up with in the Safe Circle mobile app.
        </p>
      </form>
      <p className="credit">Created and developed by Surendra B K</p>
    </div>
  )
}
