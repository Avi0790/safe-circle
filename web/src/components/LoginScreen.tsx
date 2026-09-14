import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
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

        <p className="hint">
          Use the same account you signed up with in the Safe Circle mobile app.
        </p>
      </form>
    </div>
  )
}
