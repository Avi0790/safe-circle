import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { Avatar } from '@/components/Avatar';
import { isDriving, isLowBattery, isStale, isStatusActive, speedToMph } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { MemberWithLocation } from '@/lib/types';

// A circle member on the map: their photo in a ringed bubble whose tail points
// down at a solid location dot, the dot ON where they are, so the exact spot
// reads even zoomed out; and small badges for what matters at a glance
// (driving and how fast, a low battery, their quick status). The ring goes
// grey once the location is stale, so an old position doesn't read as live.

// The marker is drawn into a fixed box with the location dot at its exact
// centre (the lower half is left empty). Every map centres a marker's view on
// its coordinate by default, so the dot lands on the spot on Apple and Google
// Maps alike, with no anchor or offset to get wrong (Apple Maps ignores
// `anchor`, and its `centerOffset` didn't line the dot up on device).
const BOX_W = 84;
const DOT_Y = 80; // the location dot's centre: the exact spot
const BOX_H = DOT_Y * 2;
const BUBBLE = 62;
const TIP_Y = DOT_Y - 7; // the tail points down into the dot
const DOT = 18;
export const PIN_ANCHOR = { x: 0.5, y: DOT_Y / BOX_H }; // = the middle

export interface PinBadges {
  stale: boolean;
  mph: number | null; // only while driving
  battery: number | null; // percent, only when low
  emoji: string | null; // an active quick status
}

export function pinBadges(member: MemberWithLocation): PinBadges {
  const loc = member.location;
  const stale = !loc || isStale(loc.recorded_at);
  const driving = !!loc && !stale && isDriving(loc.speed);
  return {
    stale,
    mph: driving ? Math.round(speedToMph(loc!.speed) ?? 0) : null,
    battery: loc && isLowBattery(loc.battery_level) ? Math.round((loc.battery_level ?? 0) * 100) : null,
    emoji: member.status_emoji && isStatusActive(member.status_expires_at) ? member.status_emoji : null,
  };
}

export function MemberPin({
  member,
  title,
  description,
  coordinate,
}: {
  member: MemberWithLocation;
  title: string;
  description?: string;
  // where to draw it instead of their last report (your own pin follows your live GPS)
  coordinate?: { latitude: number; longitude: number } | null;
}) {
  const badges = pinBadges(member);
  const badgeKey = `${badges.stale}|${badges.mph}|${badges.battery}|${badges.emoji}`;

  // A marker's view is snapshotted into a bitmap, so it keeps tracking changes
  // until the photo has drawn (it arrives asynchronously), then freezes. A
  // badge change re-opens it briefly so the new badge is drawn too. The
  // timeouts stop a hung download from tracking forever.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), 4000);
    return () => clearTimeout(timer);
  }, [member.avatar_url]);
  const firstBadges = useRef(true);
  useEffect(() => {
    if (firstBadges.current) {
      firstBadges.current = false;
      return;
    }
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(timer);
  }, [badgeKey]);

  const ring = badges.stale ? colors.offline : colors.accentFill;

  return (
    <Marker
      coordinate={coordinate ?? { latitude: member.location!.latitude, longitude: member.location!.longitude }}
      title={title}
      description={description}
      tracksViewChanges={!settled}
      anchor={PIN_ANCHOR}
      calloutAnchor={{ x: 0.5, y: 0 }}
    >
      {/* collapsable={false}: a view with only a size is flattened away by the
          new architecture, and the map then sized and centred the marker on
          its first child (the tail), putting the dot ~13 pt off the spot */}
      <View style={styles.box} collapsable={false}>
        <View style={[styles.tail, { backgroundColor: ring }]} />
        <View style={styles.dot}>
          <View style={[styles.dotCore, { backgroundColor: ring }]} />
        </View>
        <View style={[styles.ring, { backgroundColor: ring }, badges.stale && styles.faded]}>
          <View style={styles.inner}>
            <Avatar
              id={member.id}
              name={member.full_name}
              url={member.avatar_url}
              size={BUBBLE - 12}
              onSettled={() => setSettled(true)}
            />
          </View>
        </View>

        {badges.emoji && (
          <View style={[styles.badge, styles.emojiBadge]}>
            <Text allowFontScaling={false} style={styles.emoji}>{badges.emoji}</Text>
          </View>
        )}
        {badges.battery != null && (
          <View style={[styles.badge, styles.batteryBadge]}>
            <Text allowFontScaling={false} style={styles.badgeText}>🪫{badges.battery}%</Text>
          </View>
        )}
        {badges.mph != null && (
          <View style={[styles.badge, styles.speedBadge]}>
            <Text allowFontScaling={false} style={styles.badgeText}>🚗 {badges.mph}</Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.3,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
};

const styles = StyleSheet.create({
  box: { width: BOX_W, height: BOX_H },
  // the exact spot: a solid dot with a white edge, visible at any zoom
  dot: {
    position: 'absolute',
    left: BOX_W / 2 - DOT / 2,
    top: DOT_Y - DOT / 2,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  dotCore: { width: DOT - 6, height: DOT - 6, borderRadius: (DOT - 6) / 2 },
  // a square turned 45°, half hidden behind the bubble: its lower corner is the tip
  tail: {
    position: 'absolute',
    left: BOX_W / 2 - 9,
    top: TIP_Y - 9 * Math.SQRT2 - 9,
    width: 18,
    height: 18,
    borderRadius: 3,
    transform: [{ rotate: '45deg' }],
    ...shadow,
  },
  ring: {
    position: 'absolute',
    left: (BOX_W - BUBBLE) / 2,
    top: 2,
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    padding: 3,
    ...shadow,
  },
  faded: { opacity: 0.85 },
  inner: {
    flex: 1,
    borderRadius: BUBBLE / 2,
    padding: 3,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ffffff',
    ...shadow,
  },
  emojiBadge: {
    left: 4,
    top: 0,
    width: 26,
    height: 26,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  emoji: { fontSize: 14 },
  batteryBadge: {
    right: 0,
    top: 0,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: colors.dangerFill,
  },
  speedBadge: {
    left: 0,
    top: 44,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: '#111827',
  },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
});
