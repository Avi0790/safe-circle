import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { AccountTypePicker } from '@/components/AccountTypePicker';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ErrorText } from '@/components/ErrorText';
import { AuthScreen, authStyles } from '@/components/ui/AuthScreen';
import { DEFAULT_ACCOUNT_TYPE, type AccountType } from '@/lib/accountType';
import { supabase } from '@/lib/supabase';
import { useThemeVersion } from '@/lib/theme';

export default function SignupScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const [accountType, setAccountType] = useState<AccountType>(DEFAULT_ACCOUNT_TYPE);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    setError(null);
    if (!fullName.trim()) {
      setError('Enter your name.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName.trim(), account_type: accountType } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // If the project has "Confirm email" enabled, signUp succeeds but
    // returns no session until the user clicks the confirmation link.
    if (!data.session) {
      setCheckEmail(true);
    }
    // If a session came back immediately, AuthProvider's listener picks it
    // up and the root layout routes into the app on its own.
  }

  if (checkEmail) {
    return (
      <AuthScreen
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}. Open it, then come back and sign in.`}
      >
        <Link href="/(auth)/login" style={authStyles.cardLink}>
          Back to sign in
        </Link>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Create your account"
      footer={
        <>
          <Text style={authStyles.footerText}>Already have an account?</Text>
          <Link href="/(auth)/login" style={authStyles.footerLink}>
            Sign in
          </Link>
        </>
      }
    >
      <AccountTypePicker value={accountType} onChange={setAccountType} />

      <View style={authStyles.form}>
        <TextField label="Name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password-new"
          textContentType="newPassword"
        />

        {error && <ErrorText style={authStyles.error}>{error}</ErrorText>}

        <Button title="Sign up" onPress={handleSignUp} loading={loading} />
      </View>
    </AuthScreen>
  );
}
