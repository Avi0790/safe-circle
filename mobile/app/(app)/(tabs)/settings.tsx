import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
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
import { deregisterPushNotifications, registerForPushNotifications } from '@/lib/pushNotifications';

export default function SettingsTab() {
  const router = useRouter();
  const { session } = useAuth();
  const { circles, selectedCircle, setSelectedCircleId, refresh: refreshCircles } = useCircles();
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [leavingCircleId, setLeavingCircleId] = useState<string | null>(null);
  const [deletingCircleId, setDeletingCircleId] = useState<string | null>(null);
  const [renamingCircleId, setRenamingCircleId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);

  const [fullName, setFullName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .single();
      setFullName(data?.full_name ?? null);
    })();
  }, [session]);

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
    // Best-effort: a network hiccup here should never block signing out.
    if (session) {
      await deregisterPushNotifications(session.user.id).catch(() => {});
    }
    await supabase.auth.signOut();
  }

  function confirmLeaveCircle(circle: { id: string; name: string }) {
    Alert.alert(
      `Leave ${circle.name}?`,
      "You'll stop seeing this circle's members and they'll stop seeing your location.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => handleLeaveCircle(circle.id) },
      ],
    );
  }

  async function handleLeaveCircle(circleId: string) {
    if (!session) return;
    setLeavingCircleId(circleId);
    // RLS (circle_members_delete_self) already restricts this to the
    // caller's own membership row; the explicit user_id filter here is just
    // documentation of that, not what makes it safe.
    const { error } = await supabase
      .from('circle_members')
      .delete()
      .eq('circle_id', circleId)
      .eq('user_id', session.user.id);
    setLeavingCircleId(null);
    if (error) {
      setError(error.message);
      return;
    }
    // If this was the selected circle, refresh() picks another remaining
    // one (or routes back to circle-setup if that was the last one) — see
    // CircleContext's fallback logic.
    await refreshCircles();
  }

  function confirmDeleteCircle(circle: { id: string; name: string }) {
    Alert.alert(
      `Delete ${circle.name}?`,
      "This removes it for everyone in it, along with its places. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteCircle(circle.id) },
      ],
    );
  }

  async function handleDeleteCircle(circleId: string) {
    setDeletingCircleId(circleId);
    // RLS (circles_delete_creator) already restricts this to circles you
    // created; the Delete link below only appears there in the first place.
    // (Creators don't get a "Leave" option — see the render logic below —
    // because leaving your own circle would orphan it: is_member_of()
    // requires a circle_members row, so circles_select_members would stop
    // returning it and you'd lose the ability to ever see or manage it
    // again, even though circles_delete_creator would still technically
    // allow deleting it by id.)
    const { error } = await supabase.from('circles').delete().eq('id', circleId);
    setDeletingCircleId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await refreshCircles();
  }

  function startRenameCircle(circle: { id: string; name: string }) {
    setRenamingCircleId(circle.id);
    setRenameValue(circle.name);
    setRenameError(null);
  }

  async function handleSaveRename() {
    if (!renamingCircleId) return;
    const name = renameValue.trim();
    if (!name) {
      setRenameError('Give your circle a name.');
      return;
    }
    setRenameSaving(true);
    // RLS (circles_update_creator) already restricts this to circles you
    // created; the Rename link below only appears there in the first place.
    const { error } = await supabase.from('circles').update({ name }).eq('id', renamingCircleId);
    setRenameSaving(false);
    if (error) {
      setRenameError(error.message);
      return;
    }
    setRenamingCircleId(null);
    await refreshCircles();
  }

  function startEditName() {
    setNameValue(fullName ?? '');
    setNameError(null);
    setEditingName(true);
  }

  async function handleSaveName() {
    if (!session) return;
    const name = nameValue.trim();
    if (!name) {
      setNameError('Enter your name.');
      return;
    }
    setNameSaving(true);
    // RLS (profiles_update_self) already restricts this to your own row.
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name })
      .eq('id', session.user.id);
    setNameSaving(false);
    if (error) {
      setNameError(error.message);
      return;
    }
    setFullName(name);
    setEditingName(false);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Signed in as</Text>
          <Text style={typography.body}>{session?.user.email}</Text>
          {editingName ? (
            <View style={styles.renameForm}>
              <TextField
                label="Your name"
                value={nameValue}
                onChangeText={setNameValue}
                autoCapitalize="words"
              />
              {nameError && <Text style={styles.error}>{nameError}</Text>}
              <View style={styles.circleRow}>
                <View style={styles.circleButton}>
                  <Button title="Save" onPress={handleSaveName} loading={nameSaving} />
                </View>
                <View style={styles.circleButton}>
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setEditingName(false)}
                    disabled={nameSaving}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <Text style={[typography.body, styles.rowText]}>{fullName ?? '…'}</Text>
              <Pressable onPress={startEditName} hitSlop={8}>
                <Text style={styles.renameLinkText}>Edit</Text>
              </Pressable>
            </View>
          )}
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

        {circles.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Circles</Text>
            {circles.map((circle) =>
              renamingCircleId === circle.id ? (
                <View key={circle.id} style={styles.renameForm}>
                  <TextField
                    label="Circle name"
                    value={renameValue}
                    onChangeText={setRenameValue}
                    autoCapitalize="words"
                  />
                  {renameError && <Text style={styles.error}>{renameError}</Text>}
                  <View style={styles.circleRow}>
                    <View style={styles.circleButton}>
                      <Button title="Save" onPress={handleSaveRename} loading={renameSaving} />
                    </View>
                    <View style={styles.circleButton}>
                      <Button
                        title="Cancel"
                        variant="secondary"
                        onPress={() => setRenamingCircleId(null)}
                        disabled={renameSaving}
                      />
                    </View>
                  </View>
                </View>
              ) : (
                <View key={circle.id} style={styles.circleRow}>
                  <View style={styles.circleButton}>
                    <Button
                      title={circle.id === selectedCircle?.id ? `✓ ${circle.name}` : circle.name}
                      variant={circle.id === selectedCircle?.id ? 'primary' : 'secondary'}
                      onPress={() => setSelectedCircleId(circle.id)}
                    />
                  </View>
                  {circle.created_by === session?.user.id ? (
                    <>
                      <Pressable
                        onPress={() => startRenameCircle(circle)}
                        style={styles.leaveLink}
                        hitSlop={8}
                      >
                        <Text style={styles.renameLinkText}>Rename</Text>
                      </Pressable>
                      {/* Creators delete instead of leave — leaving your own
                          circle would orphan it, see handleDeleteCircle. */}
                      <Pressable
                        onPress={() => confirmDeleteCircle(circle)}
                        disabled={deletingCircleId === circle.id}
                        style={styles.leaveLink}
                        hitSlop={8}
                      >
                        {deletingCircleId === circle.id ? (
                          <ActivityIndicator size="small" color={colors.danger} />
                        ) : (
                          <Text style={styles.leaveLinkText}>Delete</Text>
                        )}
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => confirmLeaveCircle(circle)}
                      disabled={leavingCircleId === circle.id}
                      style={styles.leaveLink}
                      hitSlop={8}
                    >
                      {leavingCircleId === circle.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Text style={styles.leaveLinkText}>Leave</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              ),
            )}
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
  circleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  circleButton: { flex: 1 },
  leaveLink: { paddingHorizontal: spacing.xs },
  leaveLinkText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  renameLinkText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  renameForm: { gap: spacing.sm },
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
