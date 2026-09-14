import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { colors, spacing } from '@/lib/theme';

// One-tap emergency alert (the proposal's last stretch goal, page 3).
// Confirms first to avoid accidental fires, then shares current location
// with everyone in the circle via sos_events -> notify_sos_event trigger
// -> send-sos-push Edge Function.
export function SosButton({ onSent }: { onSent?: () => void }) {
  const [sending, setSending] = useState(false);

  function handlePress() {
    Alert.alert(
      'Send SOS?',
      'This alerts everyone in your circle with your current location.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: sendSos },
      ],
    );
  }

  async function sendSos() {
    setSending(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission denied', "Can't send your location with the SOS.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const { error } = await supabase.from('sos_events').insert({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      if (error) {
        Alert.alert('Could not send SOS', error.message);
        return;
      }
      onSent?.();
    } catch {
      Alert.alert('Could not get your location.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Pressable style={styles.button} onPress={handlePress} disabled={sending}>
      {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>SOS</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.lg,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
