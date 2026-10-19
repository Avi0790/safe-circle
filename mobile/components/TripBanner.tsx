import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useNow } from '@/hooks/useNow';
import { liveTripsOfOthers, tripEtaText, type SharedTrip } from '@/lib/sharedTrips';
import { colors, radius, spacing } from '@/lib/theme';

// Who in your circles is driving somewhere, and when they expect to arrive.
// Informational only: nothing to tap, and it disappears on its own when they
// arrive, stop sharing, or their phone goes quiet.
export function TripBanner({ trips }: { trips: SharedTrip[] }) {
  const { session } = useAuth();
  const now = useNow(30_000);
  const visible = liveTripsOfOthers(trips, session?.user.id, now);
  if (visible.length === 0) return null;

  return (
    <View style={styles.container}>
      {visible.map((trip) => (
        <View key={trip.id} style={styles.card}>
          <Text style={styles.title} numberOfLines={1}>
            🚗 {trip.profiles?.full_name ?? 'Someone'} is heading to {trip.destination}
          </Text>
          <Text style={styles.sub}>{tripEtaText(trip.eta, now)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.sm, gap: spacing.xs, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.textHeading },
  sub: { fontSize: 13, color: colors.text },
});
