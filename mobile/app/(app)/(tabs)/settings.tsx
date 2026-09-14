import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function SettingsTab() {
  const { session } = useAuth();
  const { circles, selectedCircle, setSelectedCircleId } = useCircles();
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGetInviteCode() {
    if (!selectedCircle) return;
    setError(null);
    setLoading(true);
    const { data, error } = await supabase.rpc('regenerate_invite_code', {
      target_circle_id: selectedCircle.id,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setInviteCode(data as string);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Signed in as</Text>
          <Text style={typography.body}>{session?.user.email}</Text>
        </View>

        {circles.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Circles</Text>
            {circles.map((circle) => (
              <Button
                key={circle.id}
                title={circle.id === selectedCircle?.id ? `✓ ${circle.name}` : circle.name}
                variant={circle.id === selectedCircle?.id ? 'primary' : 'secondary'}
                onPress={() => setSelectedCircleId(circle.id)}
              />
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Invite someone to {selectedCircle?.name}</Text>
          {inviteCode ? (
            <Text selectable style={styles.code}>
              {inviteCode}
            </Text>
          ) : (
            <Text style={typography.caption}>
              Generate a code to share. Creating a new one invalidates any earlier code.
            </Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          <Button title="Get invite code" onPress={handleGetInviteCode} loading={loading} />
        </View>

        <View style={styles.section}>
          <Button title="Sign out" variant="secondary" onPress={handleSignOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  section: { gap: spacing.sm },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  code: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 3,
    color: colors.accent,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  error: { color: colors.danger, fontSize: 14 },
});
