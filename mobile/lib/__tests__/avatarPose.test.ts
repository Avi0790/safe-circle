import { avatarPose, normalizeAngle, sideDepth } from '../avatarPose';

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

  it('gives a tilted car sides, and a top-down one none', () => {
    expect(sideDepth(0)).toBe(0);
    expect(sideDepth(45)).toBeGreaterThan(4);
    expect(sideDepth(60)).toBeGreaterThan(sideDepth(45));
  });
});
