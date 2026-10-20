import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAccount } from '@/contexts/AccountContext';
import { activeOrgs, ORG_DISCLOSURE } from '@/lib/orgInfo';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/lib/theme';

type Mode = 'choose' | 'create' | 'join' | 'created';

// Create an organization, or join one with a code and accept the
// disclosure. Mirrors CircleOnboarding, and like it is used twice: first-run
// onboarding for work-crew accounts (app/(app)/circle-setup.tsx, no
// `onDone`), and Settings → Work (app/(app)/add-org.tsx), so one account can
// be in family circles and a work organization at once. The two stay
// separate: circles follow circle rules, and an organization sees you only
// while you're clocked in. Joining only creates an invitation — nobody can
// see a worker until they accept the disclosure below, which is what makes
// them an active member.
export function OrgOnboarding({
  heading = 'Welcome',
  intro = 'Create an organization for your crew, or join one with the code your manager gave you.',
  onDone,
}: {
  heading?: string;
  intro?: string;
  // Called once there's nothing more to do here. Left undefined for
  // first-run onboarding, where becoming an active member is itself what
  // takes you into the app (the guard in app/(app)/_layout.tsx).
  onDone?: () => void;
} = {}) {
  const { orgs, pendingInvite, refresh } = useAccount();
  const [mode, setMode] = useState<Mode>('choose');
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createdCode, setCreatedCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setError(null);
    if (!orgName.trim()) {
      setError('Give your organization a name.');
      return;
    }
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('create_organization', {
      p_name: orgName.trim(),
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    // Not refreshed yet: as the owner you become an active member right away,
    // and refreshing would let you into the app before you've seen the code.
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
    const { data, error: rpcError } = await supabase.rpc('redeem_org_invite_code', {
      p_code: inviteCode.trim(),
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (!data) {
      setError('Invalid or expired invite code.');
      return;
    }
    if (activeOrgs(orgs).some((o) => o.org_id === data)) {
      setError("You're already in this organization.");
      return;
    }
    await refresh();
  }

  async function handleAccept() {
    if (!pendingInvite) return;
    setError(null);
    setLoading(true);
    const { error: rpcError } = await supabase.rpc('accept_org_consent', {
      p_org: pendingInvite.org_id,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
    onDone?.();
  }

  async function handleDoneAfterCreate() {
    await refresh();
    onDone?.();
  }

  async function handleDecline() {
    if (!pendingInvite) return;
    setLoading(true);
    await supabase.rpc('leave_org', { p_org: pendingInvite.org_id });
    setLoading(false);
    setMode('choose');
    await refresh();
  }

  if (pendingInvite) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={typography.title}>Join {pendingInvite.name}</Text>
        <Text style={typography.body}>
          Before you join, here is exactly what the people who run this organization can see:
        </Text>
        <View style={styles.list}>
          {ORG_DISCLOSURE.map((line) => (
            <Text key={line} style={typography.body}>
              • {line}
            </Text>
          ))}
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.form}>
          <Button title="I understand — join" onPress={handleAccept} loading={loading} />
          <Button title="Decline" variant="secondary" onPress={handleDecline} disabled={loading} />
        </View>
      </ScrollView>
    );
  }

  if (mode === 'create') {
    return (
      <View style={styles.content}>
        <Text style={typography.title}>Create an organization</Text>
        <View style={styles.form}>
          <TextField
            label="Organization name"
            placeholder="Riverside Utilities"
            value={orgName}
            onChangeText={setOrgName}
            autoCapitalize="words"
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button title="Create" onPress={handleCreate} loading={loading} />
          <Button title="Back" variant="secondary" onPress={() => setMode('choose')} />
        </View>
      </View>
    );
  }

  if (mode === 'created') {
    return (
      <View style={styles.content}>
        <Text style={typography.title}>Organization created!</Text>
        <Text style={typography.body}>
          Share this code with your crew. It's shown only once and expires in 48 hours, so save
          it now. You can make a new one later.
        </Text>
        <Text selectable style={styles.code}>
          {createdCode}
        </Text>
        <Button title="Done" onPress={handleDoneAfterCreate} />
      </View>
    );
  }

  if (mode === 'join') {
    return (
      <View style={styles.content}>
        <Text style={typography.title}>Join your crew</Text>
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
          <Button title="Continue" onPress={handleJoin} loading={loading} />
          <Button title="Back" variant="secondary" onPress={() => setMode('choose')} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <Text style={typography.title}>{heading}</Text>
      <Text style={typography.body}>{intro}</Text>
      <View style={styles.form}>
        <Button title="Create an organization" onPress={() => setMode('create')} />
        <Button title="Join with a code" variant="secondary" onPress={() => setMode('join')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.lg },
  scroll: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  list: { gap: spacing.sm },
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
