import { StyleSheet, View } from 'react-native';
import { vehicleHex, type VehicleColor, type VehicleStyle } from '@/lib/vehiclePreference';

// Top-down vehicles drawn from plain views (no SVG dependency), pointing up.
// VehicleMarker.tsx turns them to your heading on the map. (No map import
// here, so the options card can show previews anywhere.)
export function VehicleIcon({ style, color, walking = false }: { style: VehicleStyle; color: VehicleColor; walking?: boolean }) {
  const body = vehicleHex(color);
  const glass = color === 'black' ? '#4b5563' : '#1e293b';
  const outline = color === 'white' || color === 'silver' ? '#475569' : '#ffffff';

  if (walking || style === 'arrow') {
    const fill = walking ? '#16a34a' : body === '#f8fafc' ? '#2563eb' : body;
    return (
      <View style={styles.arrowWrap} accessibilityLabel={walking ? 'You (walking)' : 'You'}>
        <View style={[styles.arrowHalo, { backgroundColor: fill + '33' }]} />
        <View style={[styles.arrow, { borderBottomColor: fill }]} />
        <View style={styles.arrowNotch} />
      </View>
    );
  }

  const long = style === 'sedan' ? 44 : 48;
  const wide = style === 'sedan' ? 22 : 25;
  return (
    <View style={[styles.carWrap, { height: long + 8 }]} accessibilityLabel="You">
      <View style={[styles.shadow, { width: wide + 4, height: long + 4 }]} />
      {/* wheels */}
      <View style={[styles.wheel, { left: -2, top: 7 }]} />
      <View style={[styles.wheel, { right: -2, top: 7 }]} />
      <View style={[styles.wheel, { left: -2, bottom: 7 }]} />
      <View style={[styles.wheel, { right: -2, bottom: 7 }]} />
      <View
        style={[
          styles.body,
          {
            width: wide,
            height: long,
            backgroundColor: body,
            borderColor: outline,
            borderTopLeftRadius: style === 'sedan' ? 10 : 6,
            borderTopRightRadius: style === 'sedan' ? 10 : 6,
          },
        ]}
      >
        {/* headlights */}
        <View style={styles.lights}>
          <View style={styles.light} />
          <View style={styles.light} />
        </View>
        {/* windshield */}
        <View style={[styles.glass, { backgroundColor: glass, height: style === 'pickup' ? 7 : 9, marginTop: 5 }]} />
        {style === 'pickup' ? (
          <>
            <View style={[styles.roof, { height: 6 }]} />
            <View style={[styles.glass, { backgroundColor: glass, height: 3 }]} />
            {/* the open bed */}
            <View style={[styles.bed, { borderColor: outline }]} />
          </>
        ) : (
          <>
            <View style={[styles.roof, { height: style === 'suv' ? 17 : 12 }]}>
              {style === 'suv' && (
                <>
                  <View style={[styles.rail, { left: 2 }]} />
                  <View style={[styles.rail, { right: 2 }]} />
                </>
              )}
            </View>
            <View style={[styles.glass, { backgroundColor: glass, height: 6 }]} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrowWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowHalo: { position: 'absolute', width: 44, height: 44, borderRadius: 22 },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 28,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  // the notch at the back of the arrow, in white, like a nav chevron
  arrowNotch: {
    position: 'absolute',
    bottom: 8,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ffffff',
  },
  carWrap: { width: 34, alignItems: 'center', justifyContent: 'center' },
  shadow: { position: 'absolute', borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.25)' },
  wheel: { position: 'absolute', width: 6, height: 10, borderRadius: 2, backgroundColor: '#0f172a' },
  body: {
    borderWidth: 1.5,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    alignItems: 'center',
    overflow: 'hidden',
  },
  lights: { flexDirection: 'row', justifyContent: 'space-between', width: '80%', marginTop: 1 },
  light: { width: 5, height: 3, borderRadius: 1.5, backgroundColor: '#fef9c3' },
  glass: { width: '78%', borderRadius: 3 },
  roof: { width: '70%', marginVertical: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2 },
  rail: { position: 'absolute', top: 1, bottom: 1, width: 1.5, backgroundColor: 'rgba(0,0,0,0.35)' },
  bed: { flex: 1, width: '78%', marginVertical: 2, borderWidth: 1.5, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.25)' },
});
