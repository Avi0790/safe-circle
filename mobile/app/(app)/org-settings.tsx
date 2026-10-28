import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAccount } from '@/contexts/AccountContext';
import { confirmsName, DELETE_EFFECTS } from '@/lib/orgSettings';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// Rename the organization (owners and admins) or delete it (owners only,
// typing its name). The database checks both (migration ...000067); this
// screen offers the timesheet first, since deleting removes every shift.
export default function OrgSettingsScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();
  const { orgs, refresh } = useAccount();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const org = orgs.find((o) => o.org_id === orgId);

  const [name, setName] = useState(org?.name ?? '');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!org || (org.role !== 'owner' && org.role !== 'admin')) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Organization', headerBackTitle: 'Work' }} />
        <View style={styles.body}>
          <Text style={typography.body}>Only owners and admins can change the organization.</Text>
        </View>
      </SafeAreaView>
    );
  }
  const owner = org.role === 'owner';

  async function handleRename() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('rename_organization', { p_org: org!.org_id, p_name: name });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
    setNotice('Renamed.');
  }

  async function handleDelete() {
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('delete_organization', { p_org: org!.org_id, p_confirm_name: typed });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
    router.back();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Organization', headerBackTitle: 'Work' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>Name</Text>
        <TextField label="Organization name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={80} />
        <Button
          title="Save name"
          variant="secondary"
          onPress={handleRename}
          disabled={busy || name.trim() === '' || name.trim() === org.name}
        />
        {notice && <Text style={typography.caption}>{notice}</Text>}

        {owner && (
          <View style={styles.danger}>
            <Text style={styles.dangerTitle}>Delete {org.name}</Text>
            {DELETE_EFFECTS.map((line) => (
              <Text key={line} style={typography.body}>
                • {line}
              </Text>
            ))}
            <Text style={typography.caption}>Need the hours for payroll? Download the timesheets first.</Text>
            <Button
              title="Open timesheets"
              variant="secondary"
              onPress={() => router.push({ pathname: '/timesheets', params: { orgId: org.org_id, orgName: org.name } })}
            />
            <TextField
              label={`Type ${org.name} to confirm`}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              title="Delete organization"
              onPress={handleDelete}
              loading={busy}
              disabled={!confirmsName(typed, org.name)}
            />
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  danger: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  dangerTitle: { ...typography.heading, color: colors.danger },
  error: { color: colors.danger, fontSize: 14 },
}));
