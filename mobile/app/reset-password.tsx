import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ErrorText } from '@/components/ErrorText';
import { supabase } from '@/lib/supabase';
import { parseRecoveryTokensFromUrl } from '@/lib/passwordReset';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';
import { t } from '@/lib/i18n';

type Status = 'checking' | 'ready' | 'invalid';

// Reached via the safecircle://reset-password deep link Supabase sends in
// the password-reset email (see (auth)/forgot-password.tsx). Registered as
// an unguarded sibling of (app)/(auth) in the root layout so it's reachable
// regardless of whether the tapper is currently signed in.
export default function ResetPasswordScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
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
          <Text maxFontSizeMultiplier={1.3} style={typography.title}>{t('Link expired')}</Text>
          <Text style={typography.body}>
            {t('This password reset link is invalid or has expired. Request a new one from the sign-in screen.')}
          </Text>
          {/* router.replace('/'), not '/(auth)/login' directly: if the
              tapper is already signed in elsewhere, (auth) is guarded
              closed for them (Stack.Protected guard={!session} in the root
              layout) and that route would silently fail to navigate. '/'
              lets the root layout route to wherever they actually belong. */}
          <Button title={t('Back to sign in')} onPress={() => router.replace('/')} />
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
          <Text maxFontSizeMultiplier={1.3} style={typography.title}>{t('Set a new password')}</Text>
          <View style={styles.form}>
            <TextField
              label={t('New password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password-new"
              textContentType="newPassword"
            />
            {error && <ErrorText style={styles.error}>{error}</ErrorText>}
            <Button title={t('Save password')} onPress={handleSave} loading={saving} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
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
}));
