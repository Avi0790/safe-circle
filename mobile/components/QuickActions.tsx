import { useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { requestRide } from '@/lib/rides';
import { colors, radius, spacing } from '@/lib/theme';

// The Safe Circle actions that go beyond sharing a dot on a map — five of
// them now, too many to stack as separate pills without covering half the
// map, so they live behind one toggle instead. Sits bottom-left, opposite
// the SOS button.
export function QuickActions({ onRideRequested }: { onRideRequested: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);

  function go(path: '/walk' | '/drop-pin' | '/safety-timer' | '/text-for-help' | '/ai-help' | '/drive') {
    setOpen(false);
    router.push(path);
  }

  function confirmRide() {
    setOpen(false);
    Alert.alert(
      'Need a ride?',
      'This alerts circle-mates who are driving near you right now.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request ride', onPress: () => send(false) },
      ],
    );
  }

  async function send(everyone: boolean) {
    setRequesting(true);
    const result = await requestRide(everyone);
    setRequesting(false);
    if (!result.ok) {
      Alert.alert("Couldn't request a ride", result.error);
      return;
    }
    onRideRequested();
    if (!everyone && result.notified === 0) {
      Alert.alert(
        "Nobody's driving nearby",
        'No one in your circle is driving close to you right now. Ask everyone in the circle instead?',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Ask everyone', onPress: () => send(true) },
        ],
      );
    }
  }

  return (
    <View style={styles.container}>
      {open && (
        <View style={styles.menu}>
          <MenuRow label="🧭 Directions" onPress={() => go('/drive')} />
          <MenuRow label="🚶 Walk me home" onPress={() => go('/walk')} />
          <MenuRow label="⏱️ Check on me" onPress={() => go('/safety-timer')} />
          <MenuRow
            label="🚗 Need a ride"
            onPress={confirmRide}
            right={requesting ? <ActivityIndicator size="small" color={colors.accent} /> : undefined}
          />
          <MenuRow label="📍 Drop a pin" onPress={() => go('/drop-pin')} />
          <MenuRow label="📲 Text for help" onPress={() => go('/text-for-help')} />
          <MenuRow label="❓ Help" onPress={() => go('/ai-help')} last />
        </View>
      )}
      <Pressable style={styles.pill} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.pillText}>{open ? '✕ Close' : '⋯ Quick actions'}</Text>
      </Pressable>
    </View>
  );
}

function MenuRow({
  label,
  onPress,
  right,
  last,
}: {
  label: string;
  onPress: () => void;
  right?: ReactNode;
  last?: boolean;
}) {
  return (
    <Pressable style={[styles.menuRow, !last && styles.menuRowBorder]} onPress={onPress}>
      <Text style={styles.menuRowText}>{label}</Text>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: spacing.lg, left: spacing.lg },
  menu: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    minWidth: 200,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuRowText: { color: colors.textHeading, fontWeight: '600', fontSize: 14 },
  pill: {
    backgroundColor: colors.bg,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minWidth: 140,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pillText: { color: colors.textHeading, fontWeight: '600', fontSize: 14 },
});
