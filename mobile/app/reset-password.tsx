import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { supabase } from '@/lib/supabase';
import { parseRecoveryTokensFromUrl } from '@/lib/passwordReset';
import { colors, spacing, typography } from '@/lib/theme';

type Status = 'checking' | 'ready' | 'invalid';

// Reached via the safecircle://reset-password deep link Supabase sends in
// the password-reset email (see (auth)/forgot-password.tsx). Registered as
// an unguarded sibling of (app)/(auth) in the root layout so it's reachable
// regardless of whether the tapper is currently signed in.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function establishSession(url: string | null) {
      const tokens = parseRecoveryTokensFromUrl(url);
      if (!tokens) {
        if (!cancelled) setStatus('invalid');
        return;
      }
      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (cancelled) return;
      setStatus(error ? 'invalid' : 'ready');
    }

    // Covers a cold start (app wasn't running when the link was tapped);
    // the listener below covers a warm resume.
    Linking.getInitialURL().then(establishSession);
    const subscription = Linking.addEventListener('url', ({ url }) => establishSession(url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  async function handleSave() {
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    // AuthProvider's onAuthStateChange already saw the session that
    // setSession() established above; the root layout routes into the app
    // (or circle-setup) on its own once we leave this screen.
    router.replace('/');
  }

  if (status === 'checking') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'invalid') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={typography.title}>Link expired</Text>
          <Text style={typography.body}>
            This password reset link is invalid or has expired. Request a new one from the
            sign-in screen.
          </Text>
          <Button title="Back to sign in" onPress={() => router.replace('/(auth)/login')} />
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
          <Text style={typography.title}>Set a new password</Text>
          <View style={styles.form}>
            <TextField
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password-new"
              textContentType="newPassword"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button title="Save password" onPress={handleSave} loading={saving} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  form: { gap: spacing.md },
  error: { color: colors.danger, fontSize: 14 },
});
