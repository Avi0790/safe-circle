import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../lib/i18n'

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
          <h1>{t('Check your email')}</h1>
          <p className="subtitle">
            We sent a password reset link to {email}. Open it on this device to set a new
            password.
          </p>
          <button type="button" onClick={() => setMode('signin')}>
            {t('Back to sign in')}
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'forgot') {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleForgotPassword}>
          <h1>{t('Reset your password')}</h1>
          <p className="subtitle">{t("Enter your email and we'll send you a reset link.")}</p>

          <label>
            {t('Email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>

          {error && <p className="error" role="alert">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? t('Sending…') : t('Send reset link')}
          </button>
          <button type="button" className="link-button" onClick={() => setMode('signin')}>
            {t('Back to sign in')}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSignIn}>
        <h1>{t('Safe Circle')}</h1>
        <p className="subtitle">{t('Web dashboard for your circle and crew')}</p>

        <label>
          {t('Email')}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          {t('Password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? t('Signing in…') : t('Sign in')}
        </button>

        <button type="button" className="link-button" onClick={() => setMode('forgot')}>
          {t('Forgot password?')}
        </button>

        <p className="hint">
          {t('Use the same account you signed up with in the Safe Circle mobile app.')}
        </p>
      </form>
      <p className="credit">
        {t('Created and developed by Surendra B K')} · <a href="/privacy">{t('Privacy policy')}</a>
      </p>
    </div>
  )
}
