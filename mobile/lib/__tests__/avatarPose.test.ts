import { avatarPose, normalizeAngle, sliceLift } from '../avatarPose';

describe('avatarPose', () => {
  it('on Google Maps (Android) the marker lies flat and rotates natively', () => {
    expect(avatarPose('android', 120, 40, 45)).toEqual({ native: true, markerRotation: 120, rotate: 0, tilt: 0 });
  });

  it('on Apple Maps (iOS) the drawing turns relative to the map and tilts with it', () => {
    expect(avatarPose('ios', 120, 40, 45)).toEqual({ native: false, rotate: 80, tilt: 45 });
    expect(avatarPose('ios', 90, 90, 45).rotate).toBe(0); // heading up: the car points up the screen
    expect(avatarPose('ios', 10, 350, 0).rotate).toBe(20); // across north, the short way
    expect(avatarPose('ios', 350, 10, 0).rotate).toBe(-20);
  });

  it('never tilts edge-on', () => {
    expect(avatarPose('ios', 0, 0, 85).tilt).toBe(65);
    expect(avatarPose('ios', 0, 0, -5).tilt).toBe(0);
  });
});

describe('helpers', () => {
  it('normalizes angles to -180..180', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(720)).toBe(0);
    expect(normalizeAngle(180)).toBe(180);
  });

  it('lifts higher parts of the car further up the screen the lower the angle', () => {
    expect(sliceLift(15, 0)).toBe(0); // straight down: everything lines up
    expect(sliceLift(15, 45)).toBeCloseTo(10.61, 1);
    expect(sliceLift(15, 60)).toBeGreaterThan(sliceLift(15, 45));
    expect(sliceLift(0, 60)).toBe(0); // the road stays on the road
  });
});
