import { useState } from 'react';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountTypePicker } from '@/components/AccountTypePicker';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { DEFAULT_ACCOUNT_TYPE, type AccountType } from '@/lib/accountType';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/lib/theme';

export default function SignupScreen() {
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={typography.title}>Check your email</Text>
          <Text style={typography.body}>
            We sent a confirmation link to {email}. Open it, then come back and sign in.
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={typography.title}>Create account</Text>

          <AccountTypePicker value={accountType} onChange={setAccountType} />

          <View style={styles.form}>
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

            {error && <Text style={styles.error}>{error}</Text>}

            <Button title="Sign up" onPress={handleSignUp} loading={loading} />
          </View>

          <View style={styles.footer}>
            <Text style={typography.caption}>Already have an account?</Text>
            <Link href="/(auth)/login" style={styles.link}>
              Sign in
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  form: { gap: spacing.md },
  error: { color: colors.danger, fontSize: 14 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  link: { color: colors.accent, fontWeight: '600' },
});
