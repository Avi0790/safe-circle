import { useState } from 'react';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/lib/theme';

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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={typography.title}>Check your email</Text>
          <Text style={typography.body}>
            We sent a password reset link to {email}. Open it on this device to set a new
            password.
          </Text>
          <Link href="/(auth)/login" style={styles.link}>
            Back to sign in
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <Text style={typography.title}>Reset your password</Text>
          <Text style={[typography.body, styles.subtitle]}>
            Enter your email and we'll send you a reset link.
          </Text>

          <View style={styles.form}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button title="Send reset link" onPress={handleSend} loading={loading} />
          </View>

          <View style={styles.footer}>
            <Link href="/(auth)/login" style={styles.link}>
              Back to sign in
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  subtitle: { marginTop: -spacing.md },
  form: { gap: spacing.md },
  error: { color: colors.danger, fontSize: 14 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  link: { color: colors.accent, fontWeight: '600' },
});
