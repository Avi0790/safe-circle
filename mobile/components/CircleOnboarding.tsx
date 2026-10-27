import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { InviteQr } from '@/components/InviteQr';
import { QrScannerModal } from '@/components/QrScannerModal';
import { TextField } from '@/components/TextField';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/lib/theme';

type Mode = 'choose' | 'create' | 'join' | 'created' | 'pending';

// The create-or-join-a-circle flow. Originally only lived in
// app/(app)/circle-setup.tsx — reachable purely because Stack.Protected
// there guards on having *zero* circles (see app/(app)/_layout.tsx) — so
// once you had one circle, there was no way in the app to ever create or
// join a second. Everything else already supports it fine (CircleContext
// holds a list and a selection, Settings already lists/switches/leaves
// multiple circles); this was the one missing door. Pulled out so both
// circle-setup.tsx (first-run, no `onDone` — becoming a member is itself
// what unlocks the rest of the app) and app/(app)/add-circle.tsx
// (reachable any time from Settings) share the exact same logic.
export function CircleOnboarding({
  heading = 'Welcome',
  intro = 'Create a family circle, or join one with an invite code.',
  onDone,
}: {
  heading?: string;
  intro?: string;
  // Called once this flow has nothing more for the person to do here.
  // Left undefined for first-run onboarding: there's no other screen to
  // return to yet, and the app navigates itself once `circles` goes from
  // empty to non-empty (the guard in app/(app)/_layout.tsx).
  onDone?: () => void;
}) {
  const { refresh, setSelectedCircleId } = useCircles();
  const [mode, setMode] = useState<Mode>('choose');
  const [circleName, setCircleName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createdCode, setCreatedCode] = useState('');
  const [createdCircleId, setCreatedCircleId] = useState<string | null>(null);
  const [pendingCircleName, setPendingCircleName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

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
    // Deliberately not refreshed yet — for first-run onboarding, refreshing
    // now would flip circle-setup's guard and yank this screen away before
    // the person has had a chance to read/copy the invite code. Refresh
    // waits for "Done" instead, same as before this was pulled out.
    setCreatedCode(data?.[0]?.invite_code ?? '');
    setCreatedCircleId(data?.[0]?.circle_id ?? null);
    setMode('created');
  }

  async function handleDoneAfterCreate() {
    await refresh();
    if (createdCircleId) setSelectedCircleId(createdCircleId);
    onDone?.();
  }

  // codeOverride is for a scanned QR code, which joins straight away.
  async function handleJoin(codeOverride?: string) {
    setError(null);
    const code = (codeOverride ?? inviteCode).trim();
    if (!code) {
      setError('Enter the invite code.');
      return;
    }
    setLoading(true);
    // join_with_code (migration ...000041_join_approval.sql) instead of
    // redeem_invite_code: it also handles circles whose creator requires
    // approval, returning 'pending' rather than joining instantly.
    const { data, error } = await supabase.rpc('join_with_code', { code });
    setLoading(false);
    if (error) {
      // e.g. rate-limited ("Too many invite code attempts...")
      setError(error.message);
      return;
    }
    const result = data as {
      status: 'joined' | 'pending' | 'invalid';
      circle_id?: string;
      circle_name?: string;
    } | null;
    if (!result || result.status === 'invalid') {
      // An invalid/expired code is a normal return value, not an exception,
      // so the attempt still counts toward the rate limit.
      setError('Invalid invite code.');
      return;
    }
    if (result.status === 'pending') {
      setPendingCircleName(result.circle_name ?? 'that circle');
      setMode('pending');
      return;
    }
    await refresh();
    if (result.circle_id) setSelectedCircleId(result.circle_id);
    onDone?.();
  }

  if (mode === 'choose') {
    return (
      <View style={styles.content}>
        <Text style={typography.title}>{heading}</Text>
        <Text style={typography.body}>{intro}</Text>
        <View style={styles.form}>
          <Button title="Create a circle" onPress={() => setMode('create')} />
          <Button title="Join a circle" variant="secondary" onPress={() => setMode('join')} />
        </View>
      </View>
    );
  }

  if (mode === 'create') {
    return (
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
    );
  }

  if (mode === 'pending') {
    return (
      <View style={styles.content}>
        <Text style={typography.title}>Request sent</Text>
        <Text style={typography.body}>
          {pendingCircleName} asks its creator to approve new members. You'll get a
          notification when they decide — or tap below to check.
        </Text>
        <View style={styles.form}>
          <Button title="Check again" onPress={refresh} />
          <Button
            title="Back"
            variant="secondary"
            onPress={() => (onDone ? onDone() : setMode('choose'))}
          />
        </View>
      </View>
    );
  }

  if (mode === 'created') {
    return (
      <View style={styles.content}>
        <Text style={typography.title}>Circle created!</Text>
        <Text style={typography.body}>
          Share this code, or have people scan the QR code from the Join screen in the app. It's
          shown only once, so save it now.
        </Text>
        {createdCode ? <InviteQr code={createdCode} /> : null}
        <Text selectable style={styles.code}>
          {createdCode}
        </Text>
        <Button title="Done" onPress={handleDoneAfterCreate} />
      </View>
    );
  }

  return (
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
        <Button title="Join" onPress={() => handleJoin()} loading={loading} />
        {Platform.OS !== 'web' && (
          <Button title="Scan QR code" variant="secondary" onPress={() => setScanning(true)} />
        )}
        <Button title="Back" variant="secondary" onPress={() => setMode('choose')} />
      </View>
      <QrScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onCode={(code) => {
          setScanning(false);
          setInviteCode(code);
          handleJoin(code);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // the screen around it (a card) does the centering and padding
  content: { gap: spacing.md + 2 },
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
