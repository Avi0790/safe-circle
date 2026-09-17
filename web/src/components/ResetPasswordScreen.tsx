import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// Shown by App.tsx in place of the normal Login/Dashboard split once it
// sees a PASSWORD_RECOVERY auth event — fired automatically when this page
// loads from a Supabase password-reset email link, since the browser
// client's detectSessionInUrl (on by default, unlike the mobile client)
// has already parsed the recovery tokens out of the URL by then.
export function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Set a new password</h1>
        <p className="subtitle">You followed a password reset link — choose a new password.</p>

        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  )
}
