import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { AuthScreen, authStyles } from '@/components/ui/AuthScreen';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    setError(null);
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    setLoading(true);
    // safecircle://reset-password must be added to this Supabase project's
    // Auth > URL Configuration > Redirect URLs allowlist in the dashboard —
    // a one-time manual step, not something version-controlled here —
    // or Supabase rejects the redirect. See app/reset-password.tsx for the
    // screen that receives it.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'safecircle://reset-password',
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthScreen
        title="Check your email"
        subtitle={`We sent a password reset link to ${email}. Open it on this device to set a new password.`}
      >
        <Link href="/(auth)/login" style={authStyles.cardLink}>
          Back to sign in
        </Link>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link href="/(auth)/login" style={authStyles.footerLink}>
          Back to sign in
        </Link>
      }
    >
      <View style={authStyles.form}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        {error && <Text style={authStyles.error}>{error}</Text>}
        <Button title="Send reset link" onPress={handleSend} loading={loading} />
      </View>
    </AuthScreen>
  );
}
