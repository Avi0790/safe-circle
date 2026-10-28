import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { clearDestinations } from '@/lib/savedDestinations';
import { supabase } from '@/lib/supabase';
import { removeAvatar } from '@/lib/avatarUpload';
import { stopSharing } from '@/lib/sharingWindow';
import { deregisterPushNotifications } from '@/lib/pushNotifications';
import { clearMembersCache } from '@/lib/membersCache';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

const CONFIRM_WORD = 'DELETE';

// Permanently deletes your account and everything tied to it. Circles you
// created that still have other people in them are handed to the
// longest-standing member first (see delete_my_account in migration
// ...000045_account_data_and_ownership.sql), so leaving never wipes a
// circle out from under everyone else.
export default function DeleteAccountScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { session } = useAuth();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

  async function handleDelete() {
    if (!session || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const userId = session.user.id;
      // Stop sending locations first — once the account is gone the server
      // would refuse them anyway, but there's no reason to keep trying.
      await stopSharing().catch(() => {});
      // Profile photos live in Storage, which SQL isn't allowed to delete
      // from, so the app removes it (best-effort) before the account goes.
      const { data: profile } = await supabase.from('profiles').select('avatar_url').eq('id', userId).maybeSingle();
      if (profile?.avatar_url) await removeAvatar(userId, profile.avatar_url).catch(() => {});
      await deregisterPushNotifications(userId).catch(() => {});

      const { error: rpcError } = await supabase.rpc('delete_my_account');
      if (rpcError) {
        setError(rpcError.message);
        setBusy(false);
        return;
      }
      await clearMembersCache();
      await clearDestinations(userId);
      // The account no longer exists; this just clears the local session and
      // sends the app back to the sign-in screen.
      await supabase.auth.signOut().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Delete account' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.heading}>This can't be undone</Text>
        <Text style={typography.body}>
          Deletes your account and everything in it: your location history, messages, places you
          created, medical card, backup contacts and guest links.
        </Text>
        <Text style={typography.body}>
          Circles you created that still have other people in them are handed to the
          longest-standing member, so they keep working. Circles with no one else in them are
          deleted.
        </Text>
        <Text style={typography.caption}>
          Want a copy first? Go back to Settings → Download my data.
        </Text>
        <TextField
          label={`Type ${CONFIRM_WORD} to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
        />
        <Pressable
          style={[styles.button, (!ready || busy) && styles.buttonDisabled]}
          onPress={handleDelete}
          disabled={!ready || busy}
        >
          <Text style={styles.buttonText}>{busy ? 'Deleting…' : 'Permanently delete my account'}</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  button: {
    backgroundColor: colors.dangerFill,
    borderRadius: radius.sm,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, fontSize: 14 },
}));
