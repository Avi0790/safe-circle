import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { pickAndUploadAvatar, removeAvatar } from '@/lib/avatarUpload';
import { QUICK_STATUSES, STATUS_DURATION_MINUTES } from '@/lib/status';
import { useShakeSettings } from '@/contexts/ShakeSettingsContext';
import { useAppLock } from '@/contexts/AppLockContext';
import { colors, radius, spacing, typography } from '@/lib/theme';
import {
  getShareUntil,
  isBackgroundTaskActive,
  isTrackingActive,
  stopIfShareWindowEnded,
} from '@/lib/locationTracking';
import { SHARE_DURATIONS, startSharing, stopSharing } from '@/lib/sharingWindow';
import { formatClockTime } from '@/lib/format';
import { deregisterPushNotifications, registerForPushNotifications } from '@/lib/pushNotifications';
import { clearMembersCache } from '@/lib/membersCache';

export default function SettingsTab() {
  const router = useRouter();
  const { session } = useAuth();
  const { enabled: shakeEnabled, setEnabled: setShakeEnabled } = useShakeSettings();
  const { enabled: lockEnabled, setEnabled: setLockEnabled } = useAppLock();
  const [lockError, setLockError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleToggleLock(next: boolean) {
    setLockError(null);
    setLockError(await setLockEnabled(next));
  }

  // Everything the app holds about you, as one JSON document, through the
  // phone's share sheet (save to Files, email it to yourself, ...).
  async function handleExportData() {
    setExporting(true);
    const { data, error: rpcError } = await supabase.rpc('export_my_data');
    setExporting(false);
    if (rpcError || !data) {
      Alert.alert("Couldn't export your data", rpcError?.message ?? 'Try again in a moment.');
      return;
    }
    try {
      await Share.share({ message: JSON.stringify(data, null, 2), title: 'My Safe Circle data' });
    } catch {
      // Dismissing the share sheet isn't an error.
    }
  }
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [statusEmoji, setStatusEmoji] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSaving, setPhoneSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, status_emoji, status_expires_at, phone_number')
        .eq('id', session.user.id)
        .single();
      setFullName(data?.full_name ?? null);
      setAvatarUrl(data?.avatar_url ?? null);
      setPhoneNumber(data?.phone_number ?? null);
      setStatusEmoji(
        data?.status_expires_at && new Date(data.status_expires_at).getTime() > Date.now()
          ? (data?.status_emoji ?? null)
          : null,
      );
    })();
  }, [session]);

  function startEditPhone() {
    setPhoneValue(phoneNumber ?? '');
    setPhoneError(null);
    setEditingPhone(true);
  }

  async function handleSavePhone() {
    if (!session) return;
    const value = phoneValue.trim();
    setPhoneSaving(true);
    // RLS (profiles_update_self) already restricts this to your own row.
    // Only used for the "Text for help" SMS fallback (Map tab) — never
    // shown anywhere else.
    const { error } = await supabase
      .from('profiles')
      .update({ phone_number: value || null })
      .eq('id', session.user.id);
    setPhoneSaving(false);
    if (error) {
      setPhoneError(error.message);
      return;
    }
    setPhoneNumber(value || null);
    setEditingPhone(false);
  }

  async function handleSetStatus(emoji: string, label: string) {
    if (statusBusy) return;
    setStatusError(null);
    setStatusBusy(true);
    const isSame = statusEmoji === emoji;
    const { error } = isSame
      ? await supabase.rpc('clear_status')
      : await supabase.rpc('set_status', {
          p_emoji: emoji,
          p_text: label,
          p_minutes: STATUS_DURATION_MINUTES,
        });
    setStatusBusy(false);
    if (error) {
      setStatusError(error.message);
      return;
    }
    setStatusEmoji(isSame ? null : emoji);
  }

  async function handleChangePhoto() {
    if (!session || avatarBusy) return;
    setAvatarError(null);
    setAvatarBusy(true);
    const result = await pickAndUploadAvatar(session.user.id, avatarUrl);
    setAvatarBusy(false);
    if (result.ok) setAvatarUrl(result.url);
    else if (!result.cancelled) setAvatarError(result.error);
  }

  async function handleRemovePhoto() {
    if (!session || avatarBusy) return;
    setAvatarError(null);
    setAvatarBusy(true);
    const result = await removeAvatar(session.user.id, avatarUrl);
    setAvatarBusy(false);
    if (result.ok) setAvatarUrl(result.url);
    else if (!result.cancelled) setAvatarError(result.error);
  }

  const [sharingEnabled, setSharingEnabled] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(true);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [sharingMode, setSharingMode] = useState<'background' | 'foreground' | null>(null);
  // Chosen with the chips below, applied when sharing is switched on.
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  // End of the running temporary window, if there is one.
  const [shareUntil, setShareUntilState] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      const active = await isTrackingActive();
      setSharingEnabled(active);
      if (active) {
        setSharingMode((await isBackgroundTaskActive()) ? 'background' : 'foreground');
        setShareUntilState(await getShareUntil());
      }
      setSharingBusy(false);
    })();
  }, []);

  // Flip the toggle off by itself when the window runs out while this
  // screen is open (the tracking service stops itself either way).
  useEffect(() => {
    if (!sharingEnabled || !shareUntil) return;
    const timer = setTimeout(async () => {
      if (await stopIfShareWindowEnded()) {
        setSharingEnabled(false);
        setSharingMode(null);
        setShareUntilState(null);
      }
    }, Math.max(shareUntil.getTime() - Date.now(), 0) + 500);
    return () => clearTimeout(timer);
  }, [sharingEnabled, shareUntil]);

  async function handleToggleSharing(next: boolean) {
    setSharingError(null);
    setSharingBusy(true);
    // try/finally so an unexpected native throw (we've already hit one —
    // see startBackgroundTracking's comment on requestBackgroundPermissionsAsync)
    // can't leave the toggle stuck spinning forever.
    try {
      if (next) {
        const result = await startSharing(durationMinutes);
        if (!result.ok) {
          setSharingError(result.reason);
          setSharingEnabled(false);
          setSharingMode(null);
          setShareUntilState(null);
        } else {
          setSharingEnabled(true);
          setSharingMode(result.backgroundGranted ? 'background' : 'foreground');
          setShareUntilState(result.until ? new Date(result.until) : null);
        }
      } else {
        await stopSharing();
        setSharingEnabled(false);
        setSharingMode(null);
        setShareUntilState(null);
      }
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : 'Something went wrong.');
      setSharingEnabled(false);
      setSharingMode(null);
    } finally {
      setSharingBusy(false);
    }
  }

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushChecking, setPushChecking] = useState(true);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      // Reflects real state instead of always showing "Enable" — a token
      // row here means some device already registered for this account.
      const { data } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', session.user.id)
        .limit(1);
      setPushEnabled((data?.length ?? 0) > 0);
      setPushChecking(false);
    })();
  }, [session]);

  async function handleTogglePush(next: boolean) {
    if (!session) return;
    setPushBusy(true);
    setPushStatus(null);
    if (next) {
      const result = await registerForPushNotifications();
      setPushEnabled(result.ok);
      setPushStatus(result.ok ? null : result.message);
    } else {
      // Same as sign-out's cleanup — no per-device token id to scope to,
      // so this clears every token row for the account (see
      // deregisterPushNotifications's docstring in lib/pushNotifications.ts).
      await deregisterPushNotifications(session.user.id);
      setPushEnabled(false);
    }
    setPushBusy(false);
  }

  const [nearbyAlerts, setNearbyAlerts] = useState(false);
  const [nearbyChecking, setNearbyChecking] = useState(true);
  const [nearbyError, setNearbyError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('nearby_alerts')
        .eq('id', session.user.id)
        .single();
      setNearbyAlerts(data?.nearby_alerts ?? false);
      setNearbyChecking(false);
    })();
  }, [session]);

  async function handleToggleNearby(next: boolean) {
    if (!session) return;
    setNearbyError(null);
    setNearbyChecking(true);
    // RLS (profiles_update_self) already restricts this to your own row.
    const { error } = await supabase
      .from('profiles')
      .update({ nearby_alerts: next })
      .eq('id', session.user.id);
    if (error) {
      setNearbyError(error.message);
    } else {
      setNearbyAlerts(next);
    }
    setNearbyChecking(false);
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

  async function handleShareInvite() {
    if (!inviteCode || !selectedCircle) return;
    try {
      // React Native's built-in Share module — no extra dependency needed.
      // Message-only (no url), so it works the same on iOS and Android
      // instead of Android silently dropping a second param iOS supports.
      await Share.share({
        message: `Join my Safe Circle "${selectedCircle.name}"! Use invite code ${inviteCode} in the app.`,
      });
    } catch {
      // The share sheet itself failing (rare) isn't worth surfacing as an
      // app error — the code is still right there on screen to copy.
    }
  }

  async function handleSignOut() {
    // Best-effort: a network hiccup here should never block signing out.
    if (session) {
      await deregisterPushNotifications(session.user.id).catch(() => {});
    }
    // The cached member list is other people's locations on this device —
    // it mustn't outlive the account that was allowed to see it.
    await clearMembersCache();
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
          <View style={styles.photoRow}>
            <Pressable onPress={handleChangePhoto} disabled={avatarBusy} accessibilityLabel="Change profile photo">
              <View style={avatarBusy && styles.photoBusy}>
                <Avatar
                  id={session?.user.id ?? ''}
                  name={fullName ?? session?.user.email ?? '?'}
                  url={avatarUrl}
                  size={72}
                />
              </View>
              {avatarBusy && <ActivityIndicator style={StyleSheet.absoluteFill} />}
            </Pressable>
            <View style={styles.rowText}>
              <Text style={styles.sectionLabel}>Profile photo</Text>
              <Text style={typography.caption}>
                Shown on the map and in your circle instead of your initials.
              </Text>
              <View style={styles.circleRow}>
                <Pressable onPress={handleChangePhoto} disabled={avatarBusy} hitSlop={8}>
                  <Text style={styles.renameLinkText}>{avatarUrl ? 'Change photo' : 'Choose photo'}</Text>
                </Pressable>
                {avatarUrl && (
                  <Pressable onPress={handleRemovePhoto} disabled={avatarBusy} hitSlop={8} style={styles.leaveLink}>
                    <Text style={styles.leaveLinkText}>Remove</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
          {avatarError && <Text style={styles.error}>{avatarError}</Text>}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Quick status</Text>
            <Text style={typography.caption}>
              Shown next to your name and pin for {STATUS_DURATION_MINUTES / 60} hours, or until
              you clear it.
            </Text>
            <View style={styles.chipRow}>
              {QUICK_STATUSES.map((option) => {
                const selected = statusEmoji === option.emoji;
                return (
                  <Pressable
                    key={option.emoji}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => handleSetStatus(option.emoji, option.label)}
                    disabled={statusBusy}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option.emoji} {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {statusError && <Text style={styles.error}>{statusError}</Text>}
          </View>

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

          <Text style={styles.sectionLabel}>Phone number</Text>
          <Text style={typography.caption}>
            Only used for "Text for help" (Map tab) — a text-message fallback for when there's no
            internet for push. Never shown anywhere else.
          </Text>
          {editingPhone ? (
            <View style={styles.renameForm}>
              <TextField
                label="Phone number"
                value={phoneValue}
                onChangeText={setPhoneValue}
                keyboardType="phone-pad"
                placeholder="+1 555 123 4567"
              />
              {phoneError && <Text style={styles.error}>{phoneError}</Text>}
              <View style={styles.circleRow}>
                <View style={styles.circleButton}>
                  <Button title="Save" onPress={handleSavePhone} loading={phoneSaving} />
                </View>
                <View style={styles.circleButton}>
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setEditingPhone(false)}
                    disabled={phoneSaving}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <Text style={[typography.body, styles.rowText]}>{phoneNumber ?? 'Not set'}</Text>
              <Pressable onPress={startEditPhone} hitSlop={8}>
                <Text style={styles.renameLinkText}>Edit</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Backup contacts</Text>
          <Text style={typography.caption}>
            People outside your circle (a neighbor, a relative) to text in an emergency, in
            addition to your circle.
          </Text>
          <Button
            title="Manage backup contacts"
            variant="secondary"
            onPress={() => router.push('/backup-contacts')}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.sectionLabel}>Share my location</Text>
              <Text style={typography.caption}>
                {sharingEnabled && shareUntil
                  ? `Sharing until ${formatClockTime(shareUntil.toISOString())}, then it stops on its own.`
                  : sharingMode === 'foreground'
                    ? 'Sharing while the app is open. Background sharing needs a development build (not Expo Go) — see mobile/README.md.'
                    : sharingMode === 'background'
                      ? 'Runs in the background, even when the app is closed.'
                      : 'Choose how long to share, then switch it on.'}
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
          {!sharingEnabled && (
            <View style={styles.chipRow}>
              {SHARE_DURATIONS.map((option) => {
                const selected = option.minutes === durationMinutes;
                return (
                  <Pressable
                    key={option.label}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setDurationMinutes(option.minutes)}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {sharingError && <Text style={styles.error}>{sharingError}</Text>}
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.sectionLabel}>Push notifications</Text>
              <Text style={typography.caption}>
                Get notified when someone in your circle arrives at or leaves a place, or sends
                an SOS.
              </Text>
            </View>
            {pushChecking || pushBusy ? (
              <ActivityIndicator />
            ) : (
              <Switch
                value={pushEnabled}
                onValueChange={handleTogglePush}
                trackColor={{ true: colors.accent }}
              />
            )}
          </View>
          {pushStatus && <Text style={styles.error}>{pushStatus}</Text>}
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.sectionLabel}>Nearby alerts</Text>
              <Text style={typography.caption}>
                Get a notification when someone in your circle comes near you — about 500 m on
                foot, and farther out when you're driving so the warning comes early. Handy on
                the road, so you don't have to look at the map. Needs push notifications on.
              </Text>
            </View>
            {nearbyChecking ? (
              <ActivityIndicator />
            ) : (
              <Switch
                value={nearbyAlerts}
                onValueChange={handleToggleNearby}
                trackColor={{ true: colors.accent }}
              />
            )}
          </View>
          {nearbyError && <Text style={styles.error}>{nearbyError}</Text>}
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

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.sectionLabel}>Shake for SOS</Text>
              <Text style={typography.caption}>
                Shake your phone hard a few times to trigger the SOS alert — still asks you to
                confirm first. Handy if your phone is in a pocket or bag.
              </Text>
            </View>
            <Switch value={shakeEnabled} onValueChange={setShakeEnabled} trackColor={{ true: colors.accent }} />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.sectionLabel}>Lock the app</Text>
              <Text style={typography.caption}>
                Ask for Face ID, your fingerprint or your passcode to open Safe Circle, so a
                borrowed phone can't be used to look at your family's locations.
              </Text>
            </View>
            <Switch value={lockEnabled} onValueChange={handleToggleLock} trackColor={{ true: colors.accent }} />
          </View>
          {lockError && <Text style={styles.error}>{lockError}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Privacy</Text>
          <Text style={typography.caption}>
            See who's checked on your location, choose how long your location history is kept, and
            hide your location from specific people if you'd rather not share with everyone.
          </Text>
          <Button
            title="Who's checked on me"
            variant="secondary"
            onPress={() => router.push('/location-views')}
          />
          <Button
            title="Location history"
            variant="secondary"
            onPress={() => router.push('/history-retention')}
          />
          <Button title="Ghost mode" variant="secondary" onPress={() => router.push('/ghost-mode')} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Emergency & guests</Text>
          <Text style={typography.caption}>
            A medical card your circle can read only during an active SOS, and time-limited live
            links for people who don't have the app.
          </Text>
          <Button title="Medical card" variant="secondary" onPress={() => router.push('/medical-card')} />
          <Button title="Guest tracking link" variant="secondary" onPress={() => router.push('/share-link')} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Curfew</Text>
          <Text style={typography.caption}>
            Alert your circle automatically if you're not home by a set time.
          </Text>
          <Button title="Set curfew" variant="secondary" onPress={() => router.push('/curfew')} />
        </View>

        {circles.some((c) => c.created_by === session?.user.id) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Join approvals</Text>
            <Text style={typography.caption}>
              Require your OK before anyone new joins a circle you created, and review who's
              waiting.
            </Text>
            <Button
              title="Manage join approvals"
              variant="secondary"
              onPress={() => router.push('/join-requests')}
            />
          </View>
        )}

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
          {inviteCode && (
            <Button title="Share invite" variant="secondary" onPress={handleShareInvite} />
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your data</Text>
          <Text style={typography.caption}>
            Download everything Safe Circle holds about you, or delete your account for good.
          </Text>
          <Button title="Download my data" variant="secondary" onPress={handleExportData} loading={exporting} />
          <Button title="Delete my account" variant="secondary" onPress={() => router.push('/delete-account')} />
        </View>

        <View style={styles.section}>
          <Button title="Sign out" variant="secondary" onPress={handleSignOut} />
        </View>

        <View style={styles.aboutSection}>
          <Text style={styles.aboutTitle}>Safe Circle</Text>
          <Text style={typography.caption}>Created and developed by Surendra B K</Text>
          <Text style={typography.caption}>github.com/surendr7a/SafeCircle</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  aboutSection: { alignItems: 'center', gap: 2, paddingTop: spacing.md },
  aboutTitle: { ...typography.caption, color: colors.textHeading, fontWeight: '700' },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  section: { gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photoBusy: { opacity: 0.4 },
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
