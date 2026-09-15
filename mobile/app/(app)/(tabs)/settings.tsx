import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import {
  isBackgroundTaskActive,
  isTrackingActive,
  startBackgroundTracking,
  stopBackgroundTracking,
} from '@/lib/locationTracking';
import { registerForPushNotifications } from '@/lib/pushNotifications';

export default function SettingsTab() {
  const router = useRouter();
  const { session } = useAuth();
  const { circles, selectedCircle, setSelectedCircleId } = useCircles();
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [sharingEnabled, setSharingEnabled] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(true);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [sharingMode, setSharingMode] = useState<'background' | 'foreground' | null>(null);

  useEffect(() => {
    (async () => {
      const active = await isTrackingActive();
      setSharingEnabled(active);
      if (active) {
        setSharingMode((await isBackgroundTaskActive()) ? 'background' : 'foreground');
      }
      setSharingBusy(false);
    })();
  }, []);

  async function handleToggleSharing(next: boolean) {
    setSharingError(null);
    setSharingBusy(true);
    // try/finally so an unexpected native throw (we've already hit one —
    // see startBackgroundTracking's comment on requestBackgroundPermissionsAsync)
    // can't leave the toggle stuck spinning forever.
    try {
      if (next) {
        const result = await startBackgroundTracking();
        if (!result.ok) {
          setSharingError(result.reason);
          setSharingEnabled(false);
          setSharingMode(null);
        } else {
          setSharingEnabled(true);
          setSharingMode(result.backgroundGranted ? 'background' : 'foreground');
        }
      } else {
        await stopBackgroundTracking();
        setSharingEnabled(false);
        setSharingMode(null);
      }
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : 'Something went wrong.');
      setSharingEnabled(false);
      setSharingMode(null);
    } finally {
      setSharingBusy(false);
    }
  }

  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  async function handleEnablePush() {
    setPushBusy(true);
    setPushStatus(null);
    const result = await registerForPushNotifications();
    setPushStatus(result.ok ? 'Push notifications enabled.' : result.message);
    setPushBusy(false);
  }

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

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.sectionLabel}>Share my location</Text>
              <Text style={typography.caption}>
                {sharingMode === 'foreground'
                  ? 'Sharing while the app is open. Background sharing needs a development build (not Expo Go) — see mobile/README.md.'
                  : 'Runs in the background, even when the app is closed.'}
              </Text>
            </View>
            {sharingBusy ? (
              <ActivityIndicator />
            ) : (
              <Switch
                value={sharingEnabled}
                onValueChange={handleToggleSharing}
                trackColor={{ true: colors.accent }}
              />
            )}
          </View>
          {sharingError && <Text style={styles.error}>{sharingError}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Push notifications</Text>
          <Text style={typography.caption}>
            Get notified when someone in your circle arrives at or leaves a place.
          </Text>
          {pushStatus && <Text style={typography.caption}>{pushStatus}</Text>}
          <Button title="Enable push notifications" onPress={handleEnablePush} loading={pushBusy} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Places</Text>
          <Text style={typography.caption}>
            Get alerted when someone arrives at or leaves somewhere, like home or school.
          </Text>
          <Button
            title="Manage places"
            variant="secondary"
            onPress={() => router.push('/places')}
          />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
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
