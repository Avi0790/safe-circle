// How to draw your driving avatar so it sits on a tilted, turned map.
//
// Google Maps (Android) can lay a marker flat on the map itself: it then turns
// and tilts with the map natively, so the marker just gets your heading.
// Apple Maps (iOS) can't: its markers are flat pictures on top of the map,
// always facing the screen, and react-native-maps' rotation/flat props are
// Google-only there. So on iOS the drawing is turned by your heading
// relative to the map's own heading, and laid back by the map's tilt in
// perspective, which makes it look like it's on the road.
export interface AvatarPose {
  // Google Maps: lie flat on the map and rotate natively
  native: boolean;
  markerRotation?: number;
  // iOS: turn the drawing (degrees, clockwise from screen-up) and tilt it back
  rotate: number;
  tilt: number;
}

// -180 < angle <= 180
export function normalizeAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

export function avatarPose(platform: string, heading: number, cameraHeading: number, cameraPitch: number): AvatarPose {
  if (platform === 'android') return { native: true, markerRotation: heading, rotate: 0, tilt: 0 };
  return {
    native: false,
    rotate: normalizeAngle(heading - cameraHeading),
    // MapKit tilts at most about 60°; past ~70° the drawing would vanish edge-on
    tilt: Math.max(0, Math.min(65, cameraPitch)),
  };
}

// How far up the screen a slice of the car at height z (drawing units) is
// drawn: nothing looking straight down, more the lower the viewing angle.
// That shift is what shows the car's sides (components/CarSlices.tsx).
export function sliceLift(z: number, tilt: number): number {
  return Math.round(z * Math.sin((tilt * Math.PI) / 180) * 100) / 100;
}
