import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ErrorText } from '@/components/ErrorText';
import { AuthScreen, authStyles } from '@/components/ui/AuthScreen';
import { supabase } from '@/lib/supabase';
import { useThemeVersion } from '@/lib/theme';
import { t } from '@/lib/i18n';

export default function LoginScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  }

  return (
    <AuthScreen
      title={t('Welcome back')}
      subtitle={t('Sign in to see your circle.')}
      footer={
        <>
          <Text style={authStyles.footerText}>{t("Don't have an account?")}</Text>
          <Link href="/(auth)/signup" style={authStyles.footerLink}>
            {t('Sign up')}
          </Link>
        </>
      }
    >
      <View style={authStyles.form}>
        <TextField
          label={t('Email')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField
          label={t('Password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
        />

        {error && <ErrorText style={authStyles.error}>{t(error)}</ErrorText>}

        <Button title={t('Sign in')} onPress={handleSignIn} loading={loading} />

        <Link href="/(auth)/forgot-password" style={authStyles.cardLink}>
          {t('Forgot password?')}
        </Link>
      </View>
    </AuthScreen>
  );
}
