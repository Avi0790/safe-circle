import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import {
  mapModeOptions,
  modeHasLabelsSwitch,
  modeHasTrafficSwitch,
  type MapMode,
  type MapModePreference,
} from '@/lib/mapMode';

// "Map Modes", laid out like Apple Maps': a picture of each mode, the chosen
// one ringed in blue, and the switches that apply to it. Changes take effect
// at once (lib/mapMode.ts).
export function MapModesSheet({
  value,
  onChange,
  onClose,
  bottomInset = 0,
}: {
  value: MapModePreference;
  onChange: (p: MapModePreference) => void;
  onClose: () => void;
  bottomInset?: number;
}) {
  const options = mapModeOptions(Platform.OS);
  return (
    <View style={[styles.sheet, { paddingBottom: bottomInset + 18 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Map Modes</Text>
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.tiles}>
        {options.map(({ mode, label }) => {
          const selected = value.mode === mode;
          return (
            <Pressable
              key={mode}
              style={styles.tile}
              onPress={() => onChange({ ...value, mode })}
              accessibilityRole="button"
              accessibilityLabel={`Map mode: ${label}`}
              accessibilityState={{ selected }}
            >
              <View style={[styles.thumb, selected && styles.thumbOn]}>
                <ModeThumb mode={mode} />
              </View>
              <Text style={styles.tileLabel}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {modeHasLabelsSwitch(value.mode) && (
        <View style={styles.row}>
          <Text style={styles.rowText}>Labels</Text>
          <Switch
            value={value.labels}
            onValueChange={(labels) => onChange({ ...value, labels })}
            accessibilityLabel="Labels"
          />
        </View>
      )}
      {modeHasTrafficSwitch(value.mode) ? (
        <View style={styles.row}>
          <Text style={styles.rowText}>Traffic</Text>
          <Switch
            value={value.traffic}
            onValueChange={(traffic) => onChange({ ...value, traffic })}
            accessibilityLabel="Traffic"
          />
        </View>
      ) : (
        <Text style={styles.note}>Driving shows live traffic, with calmer colours and fewer pins.</Text>
      )}
      {value.mode === 'flyover' && Platform.OS === 'ios' && (
        <Text style={styles.note}>3D Flyover shows photo-realistic 3D in cities Apple has mapped that way; elsewhere it looks like Satellite.</Text>
      )}

      <Text style={styles.credit}>© Apple Maps / Google Maps and their data providers</Text>
    </View>
  );
}

// Little pictures of each mode (drawn, not screenshots).
function ModeThumb({ mode }: { mode: MapMode }) {
  const satellite = mode === 'satellite' || mode === 'flyover';
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      {satellite ? (
        <G>
          <Rect width="100" height="100" fill="#4f6b3a" />
          <Path d="M0 30 Q30 20 55 35 T100 30 L100 0 L0 0 Z" fill="#6b7f45" />
          <Path d="M0 70 Q40 60 100 80 L100 100 L0 100 Z" fill="#3e5a2e" />
          <Path d="M-5 95 L95 -5" stroke="#9ca3af" strokeWidth="11" />
          <Path d="M-5 95 L95 -5" stroke="#d1d5db" strokeWidth="1" strokeDasharray="4 4" />
          {mode === 'flyover' ? (
            <G>
              {/* buildings standing up in 3D */}
              <Polygon points="60,70 74,64 74,40 60,46" fill="#cbd5e1" />
              <Polygon points="74,64 84,70 84,46 74,40" fill="#94a3b8" />
              <Polygon points="60,46 74,40 84,46 70,52" fill="#e2e8f0" />
              <Polygon points="18,40 28,36 28,20 18,24" fill="#cbd5e1" />
              <Polygon points="28,36 36,40 36,24 28,20" fill="#94a3b8" />
              <Polygon points="18,24 28,20 36,24 26,28" fill="#e2e8f0" />
            </G>
          ) : (
            <G fill="#d6d3d1">
              <Rect x="60" y="55" width="16" height="10" transform="rotate(-45 68 60)" />
              <Rect x="20" y="22" width="12" height="9" transform="rotate(-45 26 26)" />
            </G>
          )}
        </G>
      ) : (
        <G>
          <Rect width="100" height="100" fill="#3b4656" />
          <Path d="M0 25 L40 0" stroke="#1f6f5a" strokeWidth="14" />
          <Rect x="58" y="62" width="30" height="24" rx="4" fill="#1f6f5a" />
          <Path d="M-5 95 L95 -5" stroke="#6b7a90" strokeWidth="12" />
          <Path d="M10 100 L100 40" stroke="#56637a" strokeWidth="6" />
          {mode === 'driving' ? (
            <G>
              <Path d="M-5 95 L35 55" stroke="#ef4444" strokeWidth="8" />
              <Path d="M35 55 L60 30" stroke="#f59e0b" strokeWidth="8" />
              <Path d="M60 30 L95 -5" stroke="#22c55e" strokeWidth="8" />
              <Polygon points="50,30 62,52 38,52" fill="#facc15" stroke="#1f2937" strokeWidth="1.5" />
              <Rect x="49" y="37" width="2" height="8" fill="#1f2937" />
              <Rect x="49" y="47" width="2" height="2" fill="#1f2937" />
            </G>
          ) : (
            <G>
              {[
                [20, 30, '#f97316'],
                [72, 20, '#eab308'],
                [30, 75, '#ef4444'],
                [78, 50, '#f97316'],
                [50, 88, '#eab308'],
              ].map(([x, y, c]) => (
                <Circle key={`${x}-${y}`} cx={x as number} cy={y as number} r="3.5" fill={c as string} />
              ))}
            </G>
          )}
        </G>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(28,46,48,0.97)',
    borderRadius: 30,
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  close: {
    position: 'absolute',
    right: 0,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#ffffff', fontSize: 20 },
  tiles: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  tile: { flex: 1, alignItems: 'center', gap: 8 },
  thumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  thumbOn: { borderColor: '#0a84ff' },
  tileLabel: { color: '#ffffff', fontSize: 15, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 6,
  },
  rowText: { color: '#ffffff', fontSize: 17 },
  note: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 12, paddingHorizontal: 6 },
  credit: { color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center', marginTop: 18 },
});
