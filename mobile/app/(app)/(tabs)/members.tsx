import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { Avatar } from '@/components/Avatar';
import { appColors, HeroCard, ui } from '@/components/ui/AppUI';
import { supabase } from '@/lib/supabase';
import {
  formatClockTime,
  getShareStatus,
  isDriving,
  isLowBattery,
  isStale,
  isStatusActive,
  speedToMph,
  timeAgo,
} from '@/lib/format';
import { formatDistanceMiles, haversineMeters } from '@/lib/geo';
import type { MemberWithLocation } from '@/lib/types';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

export default function MembersTab() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();
  const { session } = useAuth();
  const { selectedCircle, refresh: refreshCircles } = useCircles();
  const { members, isLoading, refresh } = useCircleMembers(selectedCircle?.id ?? null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const isCreator = selectedCircle?.created_by === session?.user.id;
  const myLocation = members.find((m) => m.id === session?.user.id)?.location ?? null;

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

  function confirmMakeOwner(member: MemberWithLocation) {
    if (!selectedCircle) return;
    Alert.alert(
      `Make ${member.full_name} the owner?`,
      `They'll be able to rename ${selectedCircle.name}, remove members and approve new ones. You'll become an ordinary member and can leave the circle.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make owner',
          onPress: async () => {
            const { error } = await supabase.rpc('transfer_circle_ownership', {
              p_circle_id: selectedCircle.id,
              p_new_owner: member.id,
            });
            if (error) {
              Alert.alert("Couldn't transfer ownership", error.message);
              return;
            }
            await refreshCircles();
          },
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

  const sharingNow = members.filter(
    (m) => m.location && !isStale(m.location.recorded_at) && getShareStatus(m.share_until) !== 'ended',
  ).length;
  const drivingNow = members.filter((m) => m.location && isDriving(m.location.speed)).length;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <Text style={styles.kicker}>YOUR CIRCLE</Text>
            <HeroCard colors={appColors.crew}>
              <Text style={ui.heroOrg}>{selectedCircle?.name ?? 'Circle'}</Text>
              <Text style={ui.heroRole}>
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </Text>
              <View style={styles.stats}>
                <View style={ui.stat}>
                  <Text style={ui.statValue}>{sharingNow}</Text>
                  <Text style={ui.statLabel}>Sharing now</Text>
                </View>
                <View style={ui.stat}>
                  <Text style={ui.statValue}>{drivingNow}</Text>
                  <Text style={ui.statLabel}>Driving</Text>
                </View>
              </View>
            </HeroCard>
          </View>
        }
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            onPress={() => router.push(`/member/${item.id}`)}
            canRemove={isCreator && item.id !== session?.user.id}
            onMakeOwner={() => confirmMakeOwner(item)}
            removing={removingId === item.id}
            onRemove={() => confirmRemoveMember(item)}
            distanceFrom={item.id === session?.user.id ? null : myLocation}
          />
        )}
        ListEmptyComponent={
          !isLoading ? <Text style={[typography.body, styles.empty]}>No one in this circle yet.</Text> : null
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
  onMakeOwner,
  distanceFrom,
}: {
  member: MemberWithLocation;
  onPress: () => void;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
  // Creators only (same condition as Remove): hand the circle to this member.
  onMakeOwner: () => void;
  // Your own current location, to show "X mi away" — null for your own
  // row (nothing to measure) or when your own location isn't known.
  distanceFrom: MemberWithLocation['location'];
}) {
  const stale = member.location != null && isStale(member.location.recorded_at);
  const lowBattery = isLowBattery(member.location?.battery_level ?? null);
  const driving = member.location != null && isDriving(member.location.speed);
  const mph = member.location ? speedToMph(member.location.speed) : null;
  const shareStatus = getShareStatus(member.share_until);
  const dotColor = !member.location ? colors.offline : stale ? colors.stale : colors.online;
  const distanceMiles =
    distanceFrom && member.location
      ? formatDistanceMiles(
          haversineMeters(
            distanceFrom.latitude,
            distanceFrom.longitude,
            member.location.latitude,
            member.location.longitude,
          ),
        )
      : null;
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onPress}>
        <View style={styles.avatarWrap}>
          <Avatar id={member.id} name={member.full_name} url={member.avatar_url} size={48} />
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        </View>
        <View style={styles.rowText}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{member.full_name}</Text>
            {isStatusActive(member.status_expires_at) && member.status_emoji && (
              <Text style={styles.statusChip}>
                {member.status_emoji}
                {member.status_text ? ` ${member.status_text}` : ''}
              </Text>
            )}
          </View>
          <Text style={typography.caption}>
            {shareStatus === 'ended' ? (
              'Stopped sharing'
            ) : member.location ? (
              <>
                {driving
                  ? `🚗 Driving${mph != null ? ` ${Math.round(mph)} mph` : ''}`
                  : `${stale ? 'Last seen' : 'Updated'} ${timeAgo(member.location.recorded_at)}`}
                {stale && !driving ? ' — may not be current' : ''}
                {distanceMiles && ` · ${distanceMiles} away`}
                {member.location.battery_level != null && (
                  <Text style={lowBattery && styles.lowBattery}>
                    {' · '}
                    {Math.round(member.location.battery_level * 100)}% battery
                    {lowBattery ? ' ⚠️' : ''}
                  </Text>
                )}
                {shareStatus === 'window' && member.share_until
                  ? ` · sharing until ${formatClockTime(member.share_until)}`
                  : ''}
              </>
            ) : (
              'No location shared yet'
            )}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      {canRemove && (
        <View style={styles.actions}>
          <Pressable onPress={onMakeOwner} disabled={removing} hitSlop={8} style={styles.actionChip}>
            <Text style={styles.ownerLinkText}>Make owner</Text>
          </Pressable>
          <Pressable onPress={onRemove} disabled={removing} hitSlop={8} style={[styles.actionChip, styles.actionChipDanger]}>
            <Text style={styles.removeLinkText}>{removing ? 'Removing…' : 'Remove'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: appColors.page },
  headerWrap: { gap: spacing.sm, marginBottom: spacing.xs },
  kicker: { fontSize: 13, fontWeight: '700', color: appColors.muted, letterSpacing: 0.6 },
  stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  list: { padding: spacing.md, gap: spacing.sm + 4, paddingBottom: spacing.xl },
  empty: { textAlign: 'center', marginTop: spacing.lg },
  row: { ...ui.card, gap: spacing.sm },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  actionChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.tint,
  },
  actionChipDanger: { backgroundColor: colors.dangerBg },
  ownerLinkText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  removeLinkText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  lowBattery: { color: colors.danger, fontWeight: '600' },
  avatarWrap: { position: 'relative' },
  dot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.card,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  statusChip: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
    backgroundColor: colors.tint,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  rowText: { flex: 1, gap: 3 },
  chevron: { fontSize: 24, color: colors.chevron, fontWeight: '300' },
  name: { fontSize: 16, fontWeight: '700', color: appColors.ink },
}));
