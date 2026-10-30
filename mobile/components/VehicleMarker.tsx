import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform } from 'react-native';
import { AnimatedRegion, MarkerAnimated } from 'react-native-maps';
import { TiltedAvatar } from '@/components/TiltedAvatar';
import { avatarPose } from '@/lib/avatarPose';
import { haversineMeters } from '@/lib/geo';
import { SNAP_METERS, unwrapTowards } from '@/lib/glide';
import type { LatLng } from '@/lib/navigation';
import type { VehicleColor, VehicleStyle } from '@/lib/vehiclePreference';
import { t } from '@/lib/i18n';

// You, on the navigation map, tilting and turning with it (lib/avatarPose.ts)
// and gliding between GPS fixes instead of jumping (lib/glide.ts). The glide
// runs on react-native-maps' AnimatedRegion and the turn on an Animated
// value, so neither re-renders the drawing on every frame.
//
// On Google Maps the marker lies flat on the map natively. On Apple Maps the
// drawing is laid back in perspective by the map's tilt and turned by your
// heading relative to the map, stacked in slices so its sides show.
export function VehicleMarker({
  position,
  heading,
  cameraHeading = 0,
  cameraPitch = 0,
  glideMs = 0,
  style,
  color,
  walking,
  onPress,
}: {
  position: LatLng;
  heading: number;
  // where the map itself is pointing and how far it's tilted
  cameraHeading?: number;
  cameraPitch?: number;
  // how long to take moving to `position` (about the gap between fixes)
  glideMs?: number;
  style: VehicleStyle;
  color: VehicleColor;
  walking: boolean;
  // tapping yourself opens the avatar picker, as in Google Maps
  onPress?: () => void;
}) {
  const pose = avatarPose(Platform.OS, heading, cameraHeading, cameraPitch);
  const reduceMotion = useReduceMotion();

  // ---- position
  const coordinate = useRef(
    new AnimatedRegion({ latitude: position.latitude, longitude: position.longitude, latitudeDelta: 0, longitudeDelta: 0 }),
  ).current;
  const shownAt = useRef(position);
  useEffect(() => {
    const from = shownAt.current;
    shownAt.current = position;
    const far = haversineMeters(from.latitude, from.longitude, position.latitude, position.longitude) > SNAP_METERS;
    coordinate.stopAnimation(() => {});
    coordinate
      .timing({
        latitude: position.latitude,
        longitude: position.longitude,
        latitudeDelta: 0,
        longitudeDelta: 0,
        duration: far || reduceMotion ? 0 : glideMs,
        easing: Easing.linear,
        useNativeDriver: false,
      } as Parameters<typeof coordinate.timing>[0])
      .start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.latitude, position.longitude]);

  // ---- turning (Apple Maps: the drawing's angle relative to the map)
  const angle = useRef(new Animated.Value(pose.rotate)).current;
  const angleTo = useRef(pose.rotate);
  useEffect(() => {
    const target = unwrapTowards(angleTo.current, pose.rotate);
    angleTo.current = target;
    Animated.timing(angle, {
      toValue: target,
      duration: reduceMotion ? 0 : Math.min(600, Math.max(200, glideMs)),
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose.rotate]);

  return (
    <MarkerAnimated
      // On Google Maps the look is snapshotted (tracksViewChanges off for
      // smooth movement), so a new look needs a new marker.
      key={`${walking ? 'walk' : style}-${color}`}
      coordinate={coordinate as unknown as LatLng}
      flat={pose.native}
      rotation={pose.markerRotation}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={1000}
      title={t('You')}
      onPress={onPress}
    >
      <TiltedAvatar style={style} color={color} walking={walking} rotate={pose.native ? 0 : angle} tilt={pose.tilt} />
    </MarkerAnimated>
  );
}

// iOS/Android "Reduce Motion": then everything snaps instead of gliding.
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => mounted && setReduce(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}
