import { Animated, StyleSheet } from 'react-native';
import { CarSlice, carSlices } from '@/components/CarSlices';
import { VehicleIcon } from '@/components/VehicleIcon';
import { sliceLift } from '@/lib/avatarPose';
import type { VehicleColor, VehicleStyle } from '@/lib/vehiclePreference';

// The avatar drawn as if it sits on a tilted map: every slice is laid back in
// perspective by `tilt` and turned by `rotate` (relative to the screen), and
// lifted up the screen by its height (sliceLift), so at low angles you see the
// car's side, windows and wheels from whichever way it faces (CarSlices.tsx).
// Looking straight down it is simply the top-down drawing. Used inside the map
// marker on Apple Maps (VehicleMarker.tsx); no map import here.
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
  // degrees, or an animated value in degrees (VehicleMarker glides it)
  rotate: number | Animated.Value;
  tilt: number;
}) {
  const rotateZ =
    typeof rotate === 'number'
      ? `${rotate}deg`
      : rotate.interpolate({ inputRange: [-36000, 36000], outputRange: ['-36000deg', '36000deg'] });
  const transform = (lift: number) => [
    { translateY: -lift },
    { perspective: PERSPECTIVE },
    { rotateX: `${tilt}deg` },
    { rotateZ },
  ];
  const slices = walking || tilt < 1 ? [] : carSlices(style);

  if (slices.length === 0) {
    return (
      <Animated.View style={{ transform: transform(0) }} testID="avatar-top">
        <VehicleIcon style={style} color={color} walking={walking} />
      </Animated.View>
    );
  }

  return (
    <Animated.View>
      {slices.map((slice, i) => {
        const top = i === slices.length - 1;
        return (
          <Animated.View
            key={`${slice.part}-${slice.z}`}
            style={[i === 0 ? null : StyleSheet.absoluteFill, { transform: transform(sliceLift(slice.z, tilt)) }]}
            testID={top ? 'avatar-top' : 'avatar-slice'}
          >
            <CarSlice style={style} color={color} slice={slice} />
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}
