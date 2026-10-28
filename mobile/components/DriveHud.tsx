import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TravelMode } from '@/lib/navigation';
import type { VoiceMode } from '@/lib/voicePreference';

// The navigation overlay, laid out like Google Maps: the next turn in a big
// green card at the top (and the one after it), round buttons down the right
// edge, your speed bottom-left, and a dark sheet with time, distance and
// arrival at the bottom. Glanced at, not read: big type, few words, and every
// button is one tap.
export type CameraMode = 'heading' | 'north' | 'overview';

export interface DriveHudProps {
  instruction: string;
  distanceToNext: string;
  // the arrow for the next turn (navigation.maneuverGlyph) and the one after
  glyph: string;
  thenGlyph?: string | null;
  // lane arrows for the next turn, shown as you approach it (navigation.laneArrows)
  lanes?: { glyph: string; valid: boolean }[] | null;
  // the road's posted limit, when the map has one (lib/speedLimit.ts)
  speedLimitMph?: number | null;
  overLimit?: boolean;
  speedMph: number | null;
  mode?: TravelMode;
  remainingDistance: string;
  remainingTime: string;
  arrival: string;
  rerouting: boolean;
  muted: boolean;
  voiceMode?: VoiceMode;
  // e.g. "Family" while this trip is being shared with that circle
  sharingWith?: string | null;
  // a live ETA link is out (Share ETA with anyone)
  linkShared?: boolean;
  notice?: string | null;
  topInset: number;
  bottomInset: number;
  onToggleMute: () => void;
  // Opens the card with audio, Share ETA, report an incident and add a stop.
  onMore?: () => void;
  // e.g. "⛽ Maverik" while the route goes via a stop
  stopTitle?: string | null;
  // e.g. "💥 Crash reported 0.3 mi ahead"
  alert?: string | null;
  cameraMode?: CameraMode;
  onCompass?: () => void;
  onOverview?: () => void;
  onSearch?: () => void;
  onReport?: () => void;
  onEnd: () => void;
}

const SHEET_HEIGHT = 92;

export function DriveHud(p: DriveHudProps) {
  const overview = p.cameraMode === 'overview';
  const bottomOfButtons = p.bottomInset + SHEET_HEIGHT + 16;

  return (
    <>
      {/* ---------------------------------------------------- next turn */}
      <View style={[styles.topWrap, { top: p.topInset + 6 }]} pointerEvents="box-none">
        <View style={styles.card}>
          <Text maxFontSizeMultiplier={1.3} style={styles.glyph} accessibilityElementsHidden>
            {p.rerouting ? '↻' : p.glyph}
          </Text>
          <View style={styles.cardText}>
            <Text maxFontSizeMultiplier={1.3} style={styles.distance}>{p.rerouting ? '…' : p.distanceToNext}</Text>
            <Text style={styles.instruction} numberOfLines={2}>
              {p.rerouting ? 'Rerouting…' : p.instruction}
            </Text>
          </View>
        </View>
        {p.lanes && p.lanes.length > 1 && !p.rerouting ? (
          <View style={styles.lanes} accessibilityLabel={`Lanes: ${p.lanes.map((l) => (l.valid ? 'use' : 'no')).join(', ')}`}>
            {p.lanes.map((l, i) => (
              <View key={i} style={[styles.lane, i > 0 && styles.laneDivider]}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.laneGlyph, !l.valid && styles.laneOff]}>{l.glyph}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {p.thenGlyph && !p.rerouting ? (
          <View style={styles.then}>
            <Text style={styles.thenText}>Then</Text>
            <Text style={styles.thenGlyph}>{p.thenGlyph}</Text>
          </View>
        ) : null}

        <View style={styles.pills} pointerEvents="none">
          {p.alert ? <Text style={[styles.pill, styles.pillAlert]}>{p.alert}</Text> : null}
          {p.sharingWith ? <Text style={styles.pill}>👪 Sharing this trip with {p.sharingWith}</Text> : null}
          {p.linkShared ? <Text style={styles.pill}>🔗 Live ETA link on, until you arrive</Text> : null}
          {p.stopTitle ? <Text style={styles.pill}>Via {p.stopTitle}</Text> : null}
          {p.notice ? <Text style={[styles.pill, styles.pillNotice]}>{p.notice}</Text> : null}
        </View>
      </View>

      {/* ------------------------------------------------- right edge */}
      <View style={[styles.side, { bottom: bottomOfButtons }]} pointerEvents="box-none">
        {p.onCompass && (
          <Pressable
            style={styles.round}
            onPress={p.onCompass}
            accessibilityRole="button"
            accessibilityLabel={p.cameraMode === 'north' ? 'North up' : 'Heading up'}
          >
            <View style={[styles.needle, p.cameraMode === 'north' && styles.needleNorth]}>
              <View style={styles.needleRed} />
              <View style={styles.needleWhite} />
            </View>
          </Pressable>
        )}
        {p.onSearch && (
          <Pressable style={styles.round} onPress={p.onSearch} accessibilityRole="button" accessibilityLabel="Add a stop">
            <Text allowFontScaling={false} style={styles.roundIcon}>🔍</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.round}
          onPress={p.onToggleMute}
          accessibilityRole="button"
          accessibilityLabel={p.muted ? 'Unmute voice' : 'Mute voice'}
        >
          <Text allowFontScaling={false} style={styles.roundIcon}>{p.muted ? '🔇' : p.voiceMode === 'alerts' ? '🔉' : '🔊'}</Text>
        </Pressable>
        {p.onOverview && (
          <Pressable
            style={[styles.round, overview && styles.roundOn]}
            onPress={p.onOverview}
            accessibilityRole="button"
            accessibilityLabel={overview ? 'Re-center' : 'Route overview'}
          >
            <Text allowFontScaling={false} style={styles.roundIcon}>{overview ? '◎' : '🗺️'}</Text>
          </Pressable>
        )}
        {p.onReport && (
          <Pressable style={styles.report} onPress={p.onReport} accessibilityRole="button" accessibilityLabel="Report an incident">
            <Text allowFontScaling={false} style={styles.reportIcon}>⚠️</Text>
            <Text style={styles.reportText}>Report</Text>
          </Pressable>
        )}
      </View>

      {/* ------------------------------------------- limit and speed */}
      <View style={[styles.speedColumn, { bottom: bottomOfButtons }]} pointerEvents="none">
        {p.speedLimitMph != null && p.mode !== 'walk' ? (
          <View style={styles.limitSign} accessibilityLabel={`Speed limit ${p.speedLimitMph} miles per hour`}>
            <Text style={styles.limitWord}>SPEED</Text>
            <Text style={styles.limitWord}>LIMIT</Text>
            <Text style={styles.limitValue}>{p.speedLimitMph}</Text>
          </View>
        ) : null}
        <View
          style={[styles.speed, p.overLimit && styles.speedOver]}
          accessibilityLabel={`${p.mode === 'walk' ? 'Walking speed' : 'Speed'} ${p.speedMph ?? 0} miles per hour${p.overLimit ? ', over the limit' : ''}`}
        >
          <Text style={[styles.speedValue, p.overLimit && styles.speedValueOver]}>
            {p.speedMph == null ? '—' : p.mode === 'walk' ? p.speedMph.toFixed(1) : p.speedMph}
          </Text>
          <Text style={[styles.speedUnit, p.overLimit && styles.speedValueOver]}>mph</Text>
        </View>
      </View>

      {/* ------------------------------------------------------ sheet */}
      <View style={[styles.sheet, { paddingBottom: p.bottomInset + 12 }]}>
        <Pressable
          style={styles.sheetMain}
          onPress={p.onMore}
          disabled={!p.onMore}
          accessibilityLabel="More options"
          accessibilityRole="button"
        >
          <View style={styles.handle} />
          <Text maxFontSizeMultiplier={1.3} style={styles.eta}>{p.remainingTime}</Text>
          <Text style={styles.etaSub}>
            {p.remainingDistance} · arrive {p.arrival}
          </Text>
        </Pressable>
        <Pressable style={styles.exit} onPress={p.onEnd} accessibilityRole="button" accessibilityLabel="End navigation">
          <Text style={styles.exitText}>Exit</Text>
        </Pressable>
      </View>
    </>
  );
}

const GREEN = '#0b6e4f';
const DARK = '#111827';

const styles = StyleSheet.create({
  topWrap: { position: 'absolute', left: 10, right: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: GREEN,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  glyph: { color: '#ffffff', fontSize: 44, fontWeight: '800', width: 52, textAlign: 'center' },
  cardText: { flex: 1 },
  distance: { color: '#ffffff', fontSize: 30, fontWeight: '800' },
  instruction: { color: '#e6f4ee', fontSize: 21, fontWeight: '600' },
  then: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -6,
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 16,
    backgroundColor: '#07563d',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    zIndex: -1,
  },
  thenText: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  thenGlyph: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  pills: { marginTop: 8, gap: 6, alignItems: 'flex-start' },
  pill: {
    overflow: 'hidden',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(17,24,39,0.88)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillAlert: { backgroundColor: 'rgba(185,28,28,0.95)', fontSize: 15 },
  pillNotice: { backgroundColor: 'rgba(146,64,14,0.95)' },
  side: { position: 'absolute', right: 14, alignItems: 'flex-end', gap: 12 },
  round: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: DARK,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  roundOn: { backgroundColor: '#1d4ed8' },
  roundIcon: { fontSize: 24, color: '#ffffff' },
  needle: { alignItems: 'center', transform: [{ rotate: '25deg' }] },
  needleNorth: { transform: [{ rotate: '0deg' }] },
  needleRed: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ef4444',
  },
  needleWhite: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#e5e7eb',
  },
  report: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    paddingHorizontal: 18,
    borderRadius: 28,
    backgroundColor: DARK,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  reportIcon: { fontSize: 22 },
  reportText: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  lanes: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: -10,
    paddingTop: 14,
    paddingBottom: 6,
    paddingHorizontal: 18,
    backgroundColor: '#0a5c43',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    justifyContent: 'center',
    zIndex: -1,
  },
  lane: { width: 44, alignItems: 'center' },
  laneDivider: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.35)', borderStyle: 'dashed' },
  laneGlyph: { color: '#ffffff', fontSize: 28, fontWeight: '800' },
  laneOff: { color: 'rgba(255,255,255,0.3)' },
  speedColumn: { position: 'absolute', left: 14, alignItems: 'center', gap: 8 },
  limitSign: {
    width: 54,
    paddingVertical: 4,
    backgroundColor: '#ffffff',
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: '#111827',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  limitWord: { fontSize: 9, fontWeight: '800', color: '#111827', lineHeight: 10 },
  limitValue: { fontSize: 24, fontWeight: '800', color: '#111827', lineHeight: 26 },
  speedOver: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
  speedValueOver: { color: '#dc2626' },
  speed: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  speedValue: { fontSize: 24, fontWeight: '800', color: DARK },
  speedUnit: { fontSize: 11, fontWeight: '700', color: '#4b5563', marginTop: -3 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: DARK,
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetMain: { flex: 1 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#4b5563', marginBottom: 8, marginLeft: 60 },
  eta: { color: '#4ade80', fontSize: 32, fontWeight: '700' },
  etaSub: { color: '#d1d5db', fontSize: 17 },
  exit: { backgroundColor: '#dc2626', borderRadius: 28, paddingHorizontal: 26, height: 56, justifyContent: 'center' },
  exitText: { color: '#ffffff', fontSize: 19, fontWeight: '700' },
});
