import { Platform } from 'react-native';
import { Marker } from 'react-native-maps';
import { TiltedAvatar } from '@/components/TiltedAvatar';
import { avatarPose } from '@/lib/avatarPose';
import type { LatLng } from '@/lib/navigation';
import type { VehicleColor, VehicleStyle } from '@/lib/vehiclePreference';

// You, on the navigation map, tilting and turning with it (lib/avatarPose.ts).
// On Google Maps the marker lies flat on the map natively. On Apple Maps the
// drawing is laid back in perspective by the map's tilt and turned by your
// heading relative to the map; a few darker copies stacked just below it
// give the tilted car visible sides, so it reads as a solid car on the road
// rather than a sticker.
export function VehicleMarker({
  position,
  heading,
  cameraHeading = 0,
  cameraPitch = 0,
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
  style: VehicleStyle;
  color: VehicleColor;
  walking: boolean;
  // tapping yourself opens the avatar picker, as in Google Maps
  onPress?: () => void;
}) {
  const pose = avatarPose(Platform.OS, heading, cameraHeading, cameraPitch);
  return (
    <Marker
      // On Google Maps the look is snapshotted (tracksViewChanges off for
      // smooth movement), so a new look needs a new marker.
      key={`${walking ? 'walk' : style}-${color}`}
      coordinate={position}
      flat={pose.native}
      rotation={pose.markerRotation}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={1000}
      title="You"
      onPress={onPress}
    >
      <TiltedAvatar style={style} color={color} walking={walking} rotate={pose.rotate} tilt={pose.tilt} />
    </Marker>
  );
}
