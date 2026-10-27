import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { AuthScreen, authStyles } from '@/components/ui/AuthScreen';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
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
      title="Welcome back"
      subtitle="Sign in to see your circle."
      footer={
        <>
          <Text style={authStyles.footerText}>Don't have an account?</Text>
          <Link href="/(auth)/signup" style={authStyles.footerLink}>
            Sign up
          </Link>
        </>
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
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
        />

        {error && <Text style={authStyles.error}>{error}</Text>}

        <Button title="Sign in" onPress={handleSignIn} loading={loading} />

        <Link href="/(auth)/forgot-password" style={authStyles.cardLink}>
          Forgot password?
        </Link>
      </View>
    </AuthScreen>
  );
}
