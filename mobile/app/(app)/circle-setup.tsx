import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/lib/theme';

type Mode = 'choose' | 'create' | 'join' | 'created';

export default function CircleSetupScreen() {
  const { refresh } = useCircles();
  const [mode, setMode] = useState<Mode>('choose');
  const [circleName, setCircleName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createdCode, setCreatedCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setError(null);
    if (!circleName.trim()) {
      setError('Give your circle a name.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('create_circle', { circle_name: circleName.trim() });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCreatedCode(data?.[0]?.invite_code ?? '');
    setMode('created');
  }

  async function handleJoin() {
    setError(null);
    if (!inviteCode.trim()) {
      setError('Enter the invite code.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('redeem_invite_code', { code: inviteCode.trim() });
    setLoading(false);
    if (error) {
      // e.g. rate-limited ("Too many invite code attempts...")
      setError(error.message);
      return;
    }
    if (!data) {
      // Invalid/expired code returns null rather than throwing — see
      // redeem_invite_code()'s docstring in the backend migration.
      setError('Invalid invite code.');
      return;
    }
    await refresh();
  }

  if (mode === 'choose') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={typography.title}>Welcome</Text>
          <Text style={typography.body}>
            Create a family circle, or join one with an invite code.
          </Text>
          <View style={styles.form}>
            <Button title="Create a circle" onPress={() => setMode('create')} />
            <Button title="Join a circle" variant="secondary" onPress={() => setMode('join')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (mode === 'create') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={typography.title}>Create a circle</Text>
          <View style={styles.form}>
            <TextField
              label="Circle name"
              placeholder="The Smiths"
              value={circleName}
              onChangeText={setCircleName}
              autoCapitalize="words"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button title="Create" onPress={handleCreate} loading={loading} />
            <Button title="Back" variant="secondary" onPress={() => setMode('choose')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (mode === 'created') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={typography.title}>Circle created!</Text>
          <Text style={typography.body}>
            Share this code with the people you want in your circle. It's shown only once, so
            save it now.
          </Text>
          <Text selectable style={styles.code}>
            {createdCode}
          </Text>
          <Button title="Done" onPress={refresh} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={typography.title}>Join a circle</Text>
        <View style={styles.form}>
          <TextField
            label="Invite code"
            placeholder="AB12CD"
            value={inviteCode}
            onChangeText={(text) => setInviteCode(text.toUpperCase())}
            autoCapitalize="characters"
            maxLength={6}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button title="Join" onPress={handleJoin} loading={loading} />
          <Button title="Back" variant="secondary" onPress={() => setMode('choose')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  form: { gap: spacing.md },
  error: { color: colors.danger, fontSize: 14 },
  code: {
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    color: colors.accent,
    paddingVertical: spacing.lg,
  },
});
