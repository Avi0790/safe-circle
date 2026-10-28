import { useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { requestRide } from '@/lib/rides';
import { colors, spacing, themed } from '@/lib/theme';

// The Safe Circle actions that go beyond sharing a dot on a map — five of
// them now, too many to stack as separate pills without covering half the
// map, so they live behind one toggle instead. Sits bottom-left, opposite
// the SOS button.
export function QuickActions({ onRideRequested }: { onRideRequested: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);

  function go(path: '/walk' | '/drop-pin' | '/safety-timer' | '/text-for-help' | '/ai-help' | '/drive' | '/share-trip') {
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
          <MenuRow label="🚌 Share a bus, train or flight" onPress={() => go('/share-trip')} />
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
      <Pressable accessibilityRole="button" style={styles.pill} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.pillText} maxFontSizeMultiplier={1.5}>{open ? '✕ Close' : '⋯ Quick actions'}</Text>
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
  // "🧭 Directions": the emoji goes in a tile, the words beside it
  const [icon, ...words] = label.split(' ');
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuRow, !last && styles.menuRowBorder, pressed && { backgroundColor: colors.chip }]}
      onPress={onPress}
      accessibilityLabel={label}
    >
      <View style={styles.menuRowLeft}>
        <View style={styles.menuIcon}>
          <Text allowFontScaling={false} style={styles.menuIconText}>{icon}</Text>
        </View>
        <Text style={styles.menuRowText}>{words.join(' ')}</Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { position: 'absolute', bottom: spacing.lg, left: spacing.md },
  menu: {
    backgroundColor: colors.card,
    borderRadius: 22,
    marginBottom: spacing.sm,
    minWidth: 250,
    paddingVertical: 6,
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  menuRowBorder: {},
  menuRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconText: { fontSize: 18 },
  menuRowText: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  pill: {
    backgroundColor: colors.card,
    borderRadius: 26,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 6,
    minWidth: 150,
    alignItems: 'center',
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  pillText: { color: colors.accent, fontWeight: '800', fontSize: 15 },
}));
