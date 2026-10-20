import { StyleSheet, View } from 'react-native';
import { VehicleIcon } from '@/components/VehicleIcon';
import { sideDepth } from '@/lib/avatarPose';
import type { VehicleColor, VehicleStyle } from '@/lib/vehiclePreference';

// The avatar drawn as if it sits on a tilted map: laid back in perspective by
// `tilt`, turned by `rotate` (relative to the screen), with a few darker
// copies just below it for the car's sides. Used inside the map marker on
// Apple Maps (VehicleMarker.tsx); no map import here.
const PERSPECTIVE = 420;

export function TiltedAvatar({
  style,
  color,
  walking,
  rotate,
  tilt,
}: {
  style: VehicleStyle;
  color: VehicleColor;
  walking: boolean;
  rotate: number;
  tilt: number;
}) {
  const flatOnly = walking || style === 'arrow';
  const depth = flatOnly ? 0 : sideDepth(tilt);
  const layers = depth > 0 ? [1, 0.66, 0.33] : [];
  const transform = (dy: number) => [
    { translateY: dy },
    { perspective: PERSPECTIVE },
    { rotateX: `${tilt}deg` },
    { rotateZ: `${rotate}deg` },
  ];

  return (
    <View>
      {layers.map((f) => (
        <View key={f} style={[StyleSheet.absoluteFill, { transform: transform(depth * f) }]} testID="avatar-side">
          <VehicleIcon style={style} color={color} walking={walking} lights={false} variant="side" />
        </View>
      ))}
      <View style={{ transform: transform(0) }} testID="avatar-top">
        <VehicleIcon style={style} color={color} walking={walking} />
      </View>
    </View>
  );
}
