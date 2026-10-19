import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TravelMode } from '@/lib/navigation';
import { colors, radius, spacing } from '@/lib/theme';

// The driving overlay. Deliberately sparse and large: it is glanced at, not
// read, and the only things to tap are mute and end.
export interface DriveHudProps {
  instruction: string;
  distanceToNext: string;
  speedMph: number | null;
  mode?: TravelMode;
  remainingDistance: string;
  remainingTime: string;
  arrival: string;
  rerouting: boolean;
  muted: boolean;
  // e.g. "Family" while this trip is being shared with that circle
  sharingWith?: string | null;
  notice?: string | null;
  topInset: number;
  bottomInset: number;
  onToggleMute: () => void;
  onEnd: () => void;
}

export function DriveHud(p: DriveHudProps) {
  return (
    <>
      <View style={[styles.top, { paddingTop: p.topInset + spacing.sm }]}>
        <Text style={styles.distance}>{p.rerouting ? '…' : p.distanceToNext}</Text>
        <Text style={styles.instruction} numberOfLines={2}>
          {p.rerouting ? 'Rerouting…' : p.instruction}
        </Text>
        {p.sharingWith ? <Text style={styles.sharing}>👪 Sharing this trip with {p.sharingWith}</Text> : null}
        {p.notice ? <Text style={styles.notice}>{p.notice}</Text> : null}
      </View>

      <View style={[styles.bottom, { paddingBottom: p.bottomInset + spacing.sm }]}>
        <View
          style={styles.speedBox}
          accessibilityLabel={`${p.mode === 'walk' ? 'Walking speed' : 'Speed'} ${p.speedMph ?? 0} miles per hour`}
        >
          <Text style={styles.speed}>{p.speedMph == null ? '—' : p.mode === 'walk' ? p.speedMph.toFixed(1) : p.speedMph}</Text>
          <Text style={styles.speedUnit}>mph</Text>
        </View>
        <View style={styles.trip}>
          <Text style={styles.tripMain}>{p.remainingTime}</Text>
          <Text style={styles.tripSub}>
            {p.remainingDistance} · arrive {p.arrival}
          </Text>
        </View>
        <Pressable style={styles.iconButton} onPress={p.onToggleMute} accessibilityLabel={p.muted ? 'Unmute voice' : 'Mute voice'}>
          <Text style={styles.icon}>{p.muted ? '🔇' : '🔊'}</Text>
        </Pressable>
        <Pressable style={[styles.iconButton, styles.endButton]} onPress={p.onEnd} accessibilityLabel="End navigation">
          <Text style={styles.endText}>End</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0f172a',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: 2,
  },
  distance: { color: '#ffffff', fontSize: 34, fontWeight: '800' },
  instruction: { color: '#e2e8f0', fontSize: 20, fontWeight: '600' },
  sharing: { color: '#a7f3d0', fontSize: 13, fontWeight: '600' },
  notice: { color: '#fde68a', fontSize: 13 },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#ffffff',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  speedBox: {
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  speed: { fontSize: 34, fontWeight: '800', color: colors.textHeading },
  speedUnit: { fontSize: 12, fontWeight: '600', color: colors.text, marginTop: -4 },
  trip: { flex: 1, gap: 2 },
  tripMain: { fontSize: 22, fontWeight: '700', color: colors.textHeading },
  tripSub: { fontSize: 13, color: colors.text },
  iconButton: {
    minWidth: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: { fontSize: 22 },
  endButton: { backgroundColor: colors.danger, borderColor: colors.danger, paddingHorizontal: spacing.md },
  endText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
});
