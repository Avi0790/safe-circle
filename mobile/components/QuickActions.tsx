import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { requestRide } from '@/lib/rides';
import { colors, radius, spacing } from '@/lib/theme';

// The two Safe Circle actions that go beyond sharing a dot on a map. Sits
// bottom-left on the Map tab, opposite the SOS button.
export function QuickActions({ onRideRequested }: { onRideRequested: () => void }) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);

  function confirmRide() {
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
      <Pressable style={styles.pill} onPress={() => router.push('/walk')}>
        <Text style={styles.pillText}>🚶 Walk me home</Text>
      </Pressable>
      <Pressable style={styles.pill} onPress={confirmRide} disabled={requesting}>
        {requesting ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Text style={styles.pillText}>🚗 Need a ride</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: spacing.lg, left: spacing.lg, gap: spacing.sm },
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
