import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { Avatar } from '@/components/Avatar';
import { supabase } from '@/lib/supabase';
import { isLowBattery, isStale, timeAgo } from '@/lib/format';
import type { MemberWithLocation } from '@/lib/types';
import { colors, spacing, typography } from '@/lib/theme';

export default function MembersTab() {
  const router = useRouter();
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const { members, isLoading, refresh } = useCircleMembers(selectedCircle?.id ?? null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const isCreator = selectedCircle?.created_by === session?.user.id;

  function confirmRemoveMember(member: MemberWithLocation) {
    if (!selectedCircle) return;
    Alert.alert(
      `Remove ${member.full_name}?`,
      "They'll stop seeing this circle and its members, and it'll stop seeing them.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => handleRemoveMember(selectedCircle.id, member.id),
        },
      ],
    );
  }

  async function handleRemoveMember(circleId: string, userId: string) {
    setRemovingId(userId);
    // RLS (circle_members_delete_by_creator) already restricts this to
    // circles you created, and excludes removing yourself this way — the
    // isCreator check below just decides whether to show the button.
    const { error } = await supabase
      .from('circle_members')
      .delete()
      .eq('circle_id', circleId)
      .eq('user_id', userId);
    setRemovingId(null);
    if (error) {
      Alert.alert('Could not remove member', error.message);
      return;
    }
    await refresh();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={typography.title}>{selectedCircle?.name ?? 'Circle'}</Text>
        <Text style={typography.caption}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </Text>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            onPress={() => router.push(`/member/${item.id}`)}
            canRemove={isCreator && item.id !== session?.user.id}
            removing={removingId === item.id}
            onRemove={() => confirmRemoveMember(item)}
          />
        )}
        ListEmptyComponent={
          !isLoading ? <Text style={typography.body}>No one in this circle yet.</Text> : null
        }
      />
    </SafeAreaView>
  );
}

function MemberRow({
  member,
  onPress,
  canRemove,
  removing,
  onRemove,
}: {
  member: MemberWithLocation;
  onPress: () => void;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const stale = member.location != null && isStale(member.location.recorded_at);
  const lowBattery = isLowBattery(member.location?.battery_level ?? null);
  const dotColor = !member.location ? colors.offline : stale ? colors.stale : colors.online;
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onPress}>
        <View style={styles.avatarWrap}>
          <Avatar id={member.id} name={member.full_name} size={40} />
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.name}>{member.full_name}</Text>
          <Text style={typography.caption}>
            {member.location ? (
              <>
                {stale ? 'Last seen' : 'Updated'} {timeAgo(member.location.recorded_at)}
                {stale ? ' — may not be current' : ''}
                {member.location.battery_level != null && (
                  <Text style={lowBattery && styles.lowBattery}>
                    {' · '}
                    {Math.round(member.location.battery_level * 100)}% battery
                    {lowBattery ? ' ⚠️' : ''}
                  </Text>
                )}
              </>
            ) : (
              'No location shared yet'
            )}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      {canRemove && (
        <Pressable onPress={onRemove} disabled={removing} hitSlop={8} style={styles.removeLink}>
          <Text style={styles.removeLinkText}>{removing ? 'Removing…' : 'Remove'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  list: { paddingHorizontal: spacing.lg, gap: spacing.xs, paddingBottom: spacing.lg },
  row: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  removeLink: {
    alignSelf: 'flex-end',
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  removeLinkText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  lowBattery: { color: colors.danger, fontWeight: '600' },
  avatarWrap: { position: 'relative' },
  dot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  rowText: { flex: 1, gap: 2 },
  chevron: { fontSize: 20, color: colors.offline },
  name: { fontSize: 15, fontWeight: '500', color: colors.textHeading },
});
