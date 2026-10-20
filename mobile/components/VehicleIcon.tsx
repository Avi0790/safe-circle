import { StyleSheet, View } from 'react-native';
import { vehicleHex, type VehicleColor, type VehicleStyle } from '@/lib/vehiclePreference';

// Top-down vehicles drawn from plain views (no SVG dependency), pointing up,
// with headlight beams ahead, taillights behind and a glow underneath.
// VehicleMarker.tsx turns them to your heading on the map. (No map import
// here, so the options card can show previews anywhere.)
//
// The beams sit above the vehicle and an equal space below it, so the middle
// of the drawing is the middle of the vehicle: the point the marker is
// anchored and rotated on.
const BEAM = 22;

const LIGHT_BODY = new Set(['white', 'silver', 'yellow']);

export function VehicleIcon({
  style,
  color,
  walking = false,
  lights = true,
}: {
  style: VehicleStyle;
  color: VehicleColor;
  walking?: boolean;
  lights?: boolean;
}) {
  const hex = vehicleHex(color);

  if (walking || style === 'arrow') {
    const fill = walking ? '#16a34a' : color === 'white' ? '#2563eb' : hex;
    return (
      <View style={styles.arrowWrap} accessibilityLabel={walking ? 'You (walking)' : 'You'}>
        <View style={[styles.arrowHalo, { backgroundColor: fill + '38' }]} />
        <View style={[styles.arrowRing, { borderColor: fill + 'aa' }]} />
        <View style={styles.arrowDisc}>
          <View style={[styles.arrow, { borderBottomColor: fill }]} />
          <View style={styles.arrowNotch} />
        </View>
      </View>
    );
  }

  if (style === 'moto') return <Moto hex={hex} lights={lights} />;

  const neon = style === 'neon';
  const dims = {
    sedan: { long: 44, wide: 22, nose: 10 },
    sports: { long: 46, wide: 21, nose: 14 },
    suv: { long: 48, wide: 25, nose: 6 },
    pickup: { long: 50, wide: 25, nose: 6 },
    neon: { long: 45, wide: 22, nose: 12 },
  }[style];
  const body = neon ? '#0b1020' : hex;
  const edge = neon ? hex : LIGHT_BODY.has(color) ? '#475569' : 'rgba(255,255,255,0.85)';
  const glass = neon ? hex + '55' : color === 'black' ? '#4b5563' : '#1e293b';
  const width = dims.wide + 18;

  return (
    <View style={{ width, height: dims.long + BEAM * 2, alignItems: 'center' }} accessibilityLabel="You">
      {/* glow on the road underneath */}
      <View
        style={[
          styles.glow,
          {
            top: BEAM - 6,
            width: dims.wide + 18,
            height: dims.long + 12,
            backgroundColor: neon ? hex + '66' : hex + '33',
          },
        ]}
      />
      {/* headlight beams */}
      {lights && <Beam width={dims.wide - 4} />}
      <View style={{ marginTop: lights ? 0 : BEAM }}>
        {/* wheels and mirrors stick out past the body */}
        <View style={[styles.wheel, { left: -3, top: dims.nose - 2 }]} />
        <View style={[styles.wheel, { right: -3, top: dims.nose - 2 }]} />
        <View style={[styles.wheel, { left: -3, bottom: 6 }]} />
        <View style={[styles.wheel, { right: -3, bottom: 6 }]} />
        <View style={[styles.mirror, { left: -4, top: dims.nose + 6, backgroundColor: body, borderColor: edge }]} />
        <View style={[styles.mirror, { right: -4, top: dims.nose + 6, backgroundColor: body, borderColor: edge }]} />
        {style === 'sports' && <View style={[styles.spoiler, { width: dims.wide + 6, left: -3 }]} />}

        <View
          style={[
            styles.body,
            {
              width: dims.wide,
              height: dims.long,
              backgroundColor: body,
              borderColor: edge,
              borderWidth: neon ? 2 : 1.5,
              borderTopLeftRadius: style === 'suv' || style === 'pickup' ? 7 : 12,
              borderTopRightRadius: style === 'suv' || style === 'pickup' ? 7 : 12,
              shadowColor: neon ? hex : '#000',
              shadowOpacity: neon ? 0.9 : 0.35,
              shadowRadius: neon ? 6 : 3,
            },
          ]}
        >
          <View style={styles.headlights}>
            <View style={styles.headlight} />
            <View style={styles.headlight} />
          </View>
          {/* gloss along one side of the bonnet */}
          {!neon && <View style={styles.gloss} />}
          {style === 'sports' && (
            <View style={styles.stripes}>
              <View style={styles.stripe} />
              <View style={styles.stripe} />
            </View>
          )}
          <View style={{ height: dims.nose - 6 }} />
          <View style={[styles.windshield, { backgroundColor: glass, borderColor: neon ? hex : 'transparent' }]} />
          {style === 'pickup' ? (
            <>
              <View style={[styles.roof, { height: 6 }]} />
              <View style={[styles.rearGlass, { backgroundColor: glass }]} />
              <View style={[styles.bed, { borderColor: edge }]}>
                <View style={styles.bedRib} />
                <View style={styles.bedRib} />
              </View>
            </>
          ) : (
            <>
              <View style={[styles.roof, { height: style === 'suv' ? 17 : style === 'sports' ? 9 : 12 }]}>
                {style === 'suv' && (
                  <>
                    <View style={[styles.rail, { left: 2 }]} />
                    <View style={[styles.rail, { right: 2 }]} />
                  </>
                )}
                {neon && <View style={[styles.neonLine, { backgroundColor: hex }]} />}
              </View>
              <View style={[styles.rearGlass, { backgroundColor: glass }]} />
            </>
          )}
          <View style={styles.flexFill} />
          <View style={styles.taillights}>
            <View style={styles.taillight} />
            <View style={styles.taillight} />
          </View>
        </View>
      </View>
    </View>
  );
}

// Headlight light on the road ahead: a cone widening forward, a faint outer
// one with a brighter one inside it (drawn as trapezoids with borders).
function Beam({ width }: { width: number }) {
  return (
    <View style={{ height: BEAM, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View style={[styles.cone, { width, borderLeftWidth: 11, borderRightWidth: 11, borderTopWidth: BEAM, borderTopColor: 'rgba(255,224,120,0.22)' }]} />
      <View
        style={[
          styles.cone,
          { position: 'absolute', bottom: 0, width, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: BEAM * 0.6, borderTopColor: 'rgba(255,236,150,0.4)' },
        ]}
      />
    </View>
  );
}

function Moto({ hex, lights }: { hex: string; lights: boolean }) {
  return (
    <View style={{ width: 30, height: 36 + BEAM * 2, alignItems: 'center' }} accessibilityLabel="You">
      <View style={[styles.glow, { top: BEAM - 4, width: 26, height: 44, backgroundColor: hex + '40' }]} />
      {lights ? <Beam width={4} /> : <View style={{ height: BEAM }} />}
      {/* front wheel, frame with tank, rider, rear wheel */}
      <View style={styles.motoWheel} />
      <View style={[styles.motoBar]} />
      <View style={[styles.motoTank, { backgroundColor: hex }]} />
      <View style={[styles.motoRider, { backgroundColor: hex, borderColor: '#ffffff' }]}>
        <View style={styles.motoVisor} />
      </View>
      <View style={[styles.motoTail, { backgroundColor: hex }]} />
      <View style={styles.motoWheel} />
      <View style={styles.motoTaillight} />
    </View>
  );
}

const styles = StyleSheet.create({
  arrowWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  arrowHalo: { position: 'absolute', width: 52, height: 52, borderRadius: 26 },
  arrowRing: { position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 2 },
  arrowDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 4,
  },
  arrow: {
    width: 0,
    height: 0,
    marginTop: -3,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 22,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  // the notch at the back of the arrow, in white, like a nav chevron
  arrowNotch: {
    position: 'absolute',
    bottom: 6,
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ffffff',
  },
  glow: { position: 'absolute', borderRadius: 999 },
  cone: { height: 0, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  wheel: { position: 'absolute', width: 6, height: 11, borderRadius: 2.5, backgroundColor: '#0f172a', zIndex: -1 },
  mirror: { position: 'absolute', width: 5, height: 4, borderRadius: 2, borderWidth: 1, zIndex: -1 },
  spoiler: { position: 'absolute', bottom: -2, height: 4, borderRadius: 2, backgroundColor: '#0f172a', zIndex: 2 },
  body: { alignItems: 'center', overflow: 'hidden', borderBottomLeftRadius: 7, borderBottomRightRadius: 7, elevation: 4 },
  headlights: { position: 'absolute', top: 1, flexDirection: 'row', justifyContent: 'space-between', width: '84%' },
  headlight: { width: 6, height: 3, borderRadius: 1.5, backgroundColor: '#fefce8' },
  gloss: { position: 'absolute', top: 3, left: 3, width: 3, height: '45%', borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  stripes: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', gap: 3 },
  stripe: { width: 2.5, height: '100%', backgroundColor: 'rgba(255,255,255,0.9)' },
  windshield: { width: '80%', height: 9, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderRadius: 2, borderWidth: 1 },
  roof: { width: '72%', marginVertical: 1.5, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 3 },
  rail: { position: 'absolute', top: 1, bottom: 1, width: 1.5, backgroundColor: 'rgba(0,0,0,0.4)' },
  neonLine: { position: 'absolute', left: '45%', top: 1, bottom: 1, width: 1.5, borderRadius: 1 },
  rearGlass: { width: '72%', height: 5, borderRadius: 2 },
  bed: { flex: 1, width: '80%', marginTop: 2, borderWidth: 1.5, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'space-evenly' },
  bedRib: { height: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  flexFill: { flex: 1 },
  taillights: { flexDirection: 'row', justifyContent: 'space-between', width: '86%', marginBottom: 1 },
  taillight: { width: 6, height: 2.5, borderRadius: 1, backgroundColor: '#ef4444' },
  motoWheel: { width: 6, height: 11, borderRadius: 3, backgroundColor: '#0f172a' },
  motoBar: { width: 20, height: 3, borderRadius: 1.5, backgroundColor: '#1f2937', marginTop: -2 },
  motoTank: { width: 9, height: 7, borderRadius: 3 },
  motoRider: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, alignItems: 'center' },
  motoVisor: { width: 8, height: 3, marginTop: 2, borderRadius: 2, backgroundColor: '#0f172a' },
  motoTail: { width: 7, height: 6, borderRadius: 2 },
  motoTaillight: { width: 5, height: 2, borderRadius: 1, backgroundColor: '#ef4444', marginTop: -1 },
});
