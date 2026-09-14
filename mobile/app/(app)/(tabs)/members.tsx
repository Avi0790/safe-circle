import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { timeAgo } from '@/lib/format';
import type { MemberWithLocation } from '@/lib/types';
import { colors, spacing, typography } from '@/lib/theme';

export default function MembersTab() {
  const { selectedCircle } = useCircles();
  const { members, isLoading, refresh } = useCircleMembers(selectedCircle?.id ?? null);

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
        renderItem={({ item }) => <MemberRow member={item} />}
        ListEmptyComponent={
          !isLoading ? <Text style={typography.body}>No one in this circle yet.</Text> : null
        }
      />
    </SafeAreaView>
  );
}

function MemberRow({ member }: { member: MemberWithLocation }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: member.location ? colors.online : colors.offline }]} />
      <View style={styles.rowText}>
        <Text style={styles.name}>{member.full_name}</Text>
        <Text style={typography.caption}>
          {member.location
            ? `Updated ${timeAgo(member.location.recorded_at)}${
                member.location.battery_level != null
                  ? ` · ${Math.round(member.location.battery_level * 100)}% battery`
                  : ''
              }`
            : 'No location shared yet'}
        </Text>
      </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { gap: 2 },
  name: { fontSize: 15, fontWeight: '500', color: colors.textHeading },
});
