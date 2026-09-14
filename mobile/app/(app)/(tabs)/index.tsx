import { useEffect, useRef, useState } from 'react';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';

const DEFAULT_REGION = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

export default function MapTab() {
  const { selectedCircleId } = useCircles();
  const { members, isLoading } = useCircleMembers(selectedCircleId);
  const mapRef = useRef<MapView>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const located = members.filter((m) => m.location);

  useEffect(() => {
    if (located.length === 0 || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      located.map((m) => ({
        latitude: m.location!.latitude,
        longitude: m.location!.longitude,
      })),
      { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.length]);

  // Manual, one-off location share. This stands in for the real background
  // tracking service (permissions flow, throttling, offline queue), which
  // is AJ's layer — see backend/README.md and the proposal's team split.
  async function handleShareLocation() {
    setShareError(null);
    setSharing(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setShareError('Location permission denied.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const { error } = await supabase.from('locations').insert({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        battery_level: null,
      });
      if (error) setShareError(error.message);
    } catch {
      setShareError('Could not get your location.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
      >
        {located.map((member) => (
          <Marker
            key={member.id}
            coordinate={{
              latitude: member.location!.latitude,
              longitude: member.location!.longitude,
            }}
            title={member.full_name}
            description={
              member.location!.battery_level != null
                ? `${Math.round(member.location!.battery_level * 100)}% battery`
                : undefined
            }
          />
        ))}
      </MapView>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      )}

      <View style={styles.shareBar}>
        {shareError && <Text style={styles.error}>{shareError}</Text>}
        <Pressable
          style={[styles.shareButton, sharing && styles.shareButtonDisabled]}
          onPress={handleShareLocation}
          disabled={sharing}
        >
          {sharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.shareButtonText}>Share my location</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  loadingOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shareBar: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  shareButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  shareButtonDisabled: { opacity: 0.7 },
  shareButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  error: {
    color: colors.danger,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    fontSize: 13,
  },
});
