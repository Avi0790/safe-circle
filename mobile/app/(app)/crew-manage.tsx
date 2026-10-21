import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import type { RosterMember } from '@/lib/crew';
import { supabase } from '@/lib/supabase';
import {
  allowedMemberActions,
  buildTeams,
  type MemberAction,
  type OrgRole,
  type TeamMemberRow,
  type TeamRow,
} from '@/lib/teams';
import { colors, radius, spacing, typography } from '@/lib/theme';

const ROLE_RANK: Record<OrgRole, number> = { owner: 0, admin: 1, manager: 2, worker: 3 };

// People and teams for owners and admins. A manager only sees the workers on
// teams they lead, so the setup is: make someone a manager, put them on a
// team as its lead, add the workers they oversee. The database enforces who
// may do what (migration ...000048); the buttons shown here just mirror it.
export default function CrewManageScreen() {
  const { session } = useAuth();
  const { orgs } = useAccount();
  const { orgId, orgName } = useLocalSearchParams<{ orgId: string; orgName?: string }>();
  const callerRole = orgs.find((o) => o.org_id === orgId)?.role ?? 'worker';
  const canManage = callerRole === 'owner' || callerRole === 'admin';

  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRow[]>([]);
  const [teamMemberRows, setTeamMemberRows] = useState<TeamMemberRow[]>([]);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || !canManage) return;
    const [rosterRes, teamsRes] = await Promise.all([
      supabase.rpc('org_roster', { p_org: orgId }),
      supabase.from('teams').select('id, name').eq('org_id', orgId).order('name'),
    ]);
    if (rosterRes.error || teamsRes.error) {
      setError((rosterRes.error ?? teamsRes.error)!.message);
      return;
    }
    const teams = (teamsRes.data as TeamRow[]) ?? [];
    let members: TeamMemberRow[] = [];
    if (teams.length > 0) {
      const { data } = await supabase
        .from('team_members')
        .select('team_id, user_id, is_lead')
        .in('team_id', teams.map((t) => t.id));
      members = (data as TeamMemberRow[]) ?? [];
    }
    setRoster((rosterRes.data as RosterMember[]) ?? []);
    setTeamRows(teams);
    setTeamMemberRows(members);
  }, [orgId, canManage]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function run(call: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    setBusy(true);
    const { error: rpcError } = await call();
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
  }

  function applyAction(person: RosterMember, action: MemberAction) {
    if (action.kind === 'role') {
      run(() =>
        supabase.rpc('set_org_member_role', { p_org: orgId, p_user: person.user_id, p_role: action.role }),
      );
      return;
    }
    Alert.alert(
      `Remove ${person.full_name}?`,
      'They lose access to this organization, are clocked out if on shift, and are taken off every team.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            run(() => supabase.rpc('remove_org_member', { p_org: orgId, p_user: person.user_id })),
        },
      ],
    );
  }

  function createTeam() {
    const name = newTeamName.trim();
    if (!name) {
      setError('Give the team a name.');
      return;
    }
    setNewTeamName('');
    run(() => supabase.rpc('create_team', { p_org: orgId, p_name: name }));
  }

  function confirmDeleteTeam(teamId: string, name: string) {
    Alert.alert(`Delete ${name}?`, 'The people on it stay in the organization.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => run(() => supabase.rpc('delete_team', { p_team: teamId })),
      },
    ]);
  }

  if (!canManage) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: 'Manage crew', headerBackTitle: 'Work' }} />
        <View style={styles.body}>
          <Text style={typography.body}>Only owners and admins can manage people and teams.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const people = [...roster].sort(
    (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.full_name.localeCompare(b.full_name),
  );
  const teams = buildTeams(teamRows, teamMemberRows, roster);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: orgName ? `${orgName}: crew` : 'Manage crew', headerBackTitle: 'Work' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={typography.body}>
          A manager sees the workers on teams they lead. Make someone a manager, add them to a team
          as its lead, then add the workers they oversee.
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.sectionLabel}>People</Text>
        {people.map((p) => {
          const isSelf = p.user_id === session?.user.id;
          const actions = allowedMemberActions(callerRole as OrgRole, p, isSelf);
          const open = expandedPerson === p.user_id;
          return (
            <Pressable
              key={p.user_id}
              style={styles.card}
              disabled={actions.length === 0}
              onPress={() => setExpandedPerson(open ? null : p.user_id)}
            >
              <Text style={styles.name}>
                {p.full_name}
                {isSelf ? ' (you)' : ''}
              </Text>
              <Text style={typography.caption}>
                {p.role}
                {p.status === 'invited' ? ' · waiting to accept' : ''}
              </Text>
              {open &&
                actions.map((a) => (
                  <Button
                    key={a.label}
                    title={a.label}
                    variant="secondary"
                    disabled={busy}
                    onPress={() => applyAction(p, a)}
                  />
                ))}
            </Pressable>
          );
        })}

        <Text style={styles.sectionLabel}>Teams</Text>
        <View style={styles.newTeam}>
          <TextField
            label="New team"
            placeholder="Crew A"
            value={newTeamName}
            onChangeText={setNewTeamName}
            autoCapitalize="words"
          />
          <Button title="Create team" onPress={createTeam} disabled={busy} />
        </View>

        {teams.length === 0 && <Text style={typography.caption}>No teams yet.</Text>}
        {teams.map((team) => {
          const open = expandedTeam === team.id;
          return (
            <View key={team.id} style={styles.card}>
              <Pressable onPress={() => setExpandedTeam(open ? null : team.id)}>
                <Text style={styles.name}>{team.name}</Text>
                <Text style={typography.caption}>
                  {team.members.length} {team.members.length === 1 ? 'person' : 'people'} · tap to{' '}
                  {open ? 'close' : 'edit'}
                </Text>
              </Pressable>

              {open && (
                <>
                  {team.members.map((m) => (
                    <View key={m.user_id} style={styles.teamRow}>
                      <Text style={typography.body}>
                        {m.full_name} ({m.role}){m.is_lead ? ' · lead' : ''}
                      </Text>
                      <View style={styles.rowButtons}>
                        {m.role === 'manager' && (
                          <Button
                            title={m.is_lead ? 'Remove as lead' : 'Make lead'}
                            variant="secondary"
                            disabled={busy}
                            onPress={() =>
                              run(() =>
                                supabase.rpc('set_team_member', {
                                  p_team: team.id,
                                  p_user: m.user_id,
                                  p_is_lead: !m.is_lead,
                                }),
                              )
                            }
                          />
                        )}
                        <Button
                          title="Take off team"
                          variant="secondary"
                          disabled={busy}
                          onPress={() =>
                            run(() =>
                              supabase.rpc('remove_team_member', { p_team: team.id, p_user: m.user_id }),
                            )
                          }
                        />
                      </View>
                    </View>
                  ))}

                  {team.candidates.length > 0 && <Text style={styles.sectionLabel}>Add to team</Text>}
                  {team.candidates.map((c) => (
                    <Button
                      key={c.user_id}
                      title={`+ ${c.full_name} (${c.role})`}
                      variant="secondary"
                      disabled={busy}
                      onPress={() =>
                        run(() =>
                          supabase.rpc('set_team_member', {
                            p_team: team.id,
                            p_user: c.user_id,
                            p_is_lead: false,
                          }),
                        )
                      }
                    />
                  ))}

                  <Button
                    title="Delete team"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => confirmDeleteTeam(team.id, team.name)}
                  />
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.sm },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  newTeam: { gap: spacing.sm },
  teamRow: { gap: spacing.xs },
  rowButtons: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: 16, fontWeight: '600', color: colors.textHeading },
  error: { color: colors.danger, fontSize: 14 },
});
