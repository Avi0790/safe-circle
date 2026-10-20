import { Marker } from 'react-native-maps';
import { VehicleIcon } from '@/components/VehicleIcon';
import type { LatLng } from '@/lib/navigation';
import type { VehicleColor, VehicleStyle } from '@/lib/vehiclePreference';

// The marker that stands for you on the navigation map. Flat on the map and
// rotated to your heading, so with the map turned heading-up it points ahead.
export function VehicleMarker({
  position,
  heading,
  style,
  color,
  walking,
  onPress,
}: {
  position: LatLng;
  heading: number;
  style: VehicleStyle;
  color: VehicleColor;
  walking: boolean;
  // tapping yourself opens the avatar picker, as in Google Maps
  onPress?: () => void;
}) {
  return (
    <Marker
      // Its look is snapshotted (tracksViewChanges off for smooth movement),
      // so a new look needs a new marker.
      key={`${walking ? 'walk' : style}-${color}`}
      coordinate={position}
      flat
      rotation={heading}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={1000}
      title="You"
      onPress={onPress}
    >
      <VehicleIcon style={style} color={color} walking={walking} />
    </Marker>
  );
}
