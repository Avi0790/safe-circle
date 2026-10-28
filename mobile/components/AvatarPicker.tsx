import { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import { AvatarArt } from '@/components/AvatarArt';
import {
  DEFAULT_VEHICLE,
  VEHICLE_COLORS,
  VEHICLE_STYLES,
  vehicleColorName,
  vehicleStyleName,
  type VehiclePreference,
} from '@/lib/vehiclePreference';

// "Choose driving avatar", laid out like Google Maps': swipe through the
// avatars (the one in the middle stands on a glowing platform), pick a colour
// by name, then Done. Nothing changes until Done; ✕ keeps what you had and
// Reset goes back to the default arrow.
const ITEM_W = Math.min(260, Math.round(Dimensions.get('window').width * 0.62));
const TEAL = '#5bb8c9';

export function AvatarPicker({
  value,
  onDone,
  onClose,
  bottomInset = 0,
}: {
  value: VehiclePreference;
  onDone: (v: VehiclePreference) => void;
  onClose: () => void;
  bottomInset?: number;
}) {
  const [draft, setDraft] = useState<VehiclePreference>(value);
  const scroller = useRef<ScrollView>(null);
  const index = Math.max(0, VEHICLE_STYLES.findIndex((s) => s.style === draft.style));
  const sidePad = (Dimensions.get('window').width - ITEM_W) / 2;

  // Start with the current avatar in the middle.
  useEffect(() => {
    const t = setTimeout(() => scroller.current?.scrollTo({ x: index * ITEM_W, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(i: number) {
    setDraft((d) => ({ ...d, style: VEHICLE_STYLES[i].style }));
    scroller.current?.scrollTo({ x: i * ITEM_W, animated: true });
  }

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / ITEM_W);
    const clamped = Math.min(VEHICLE_STYLES.length - 1, Math.max(0, i));
    setDraft((d) => ({ ...d, style: VEHICLE_STYLES[clamped].style }));
  }

  return (
    <View style={[styles.sheet, { paddingBottom: bottomInset + 16 }]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Choose driving avatar</Text>
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_W}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        onMomentumScrollEnd={onScrollEnd}
      >
        {VEHICLE_STYLES.map(({ style, label }, i) => {
          const selected = i === index;
          return (
            <Pressable
              key={style}
              style={[styles.item, { width: ITEM_W }]}
              onPress={() => pick(i)}
              accessibilityRole="button"
              accessibilityLabel={`Avatar: ${label}`}
              accessibilityState={{ selected }}
            >
              {selected && (
                <Svg style={styles.platform} width={ITEM_W * 0.92} height={50} viewBox="0 0 200 50">
                  <Ellipse cx="100" cy="25" rx="96" ry="21" fill="#0b4f5c" stroke={TEAL} strokeWidth="3" />
                </Svg>
              )}
              <View style={[styles.art, !selected && styles.artDim]}>
                <AvatarArt style={style} color={draft.color} width={ITEM_W * 0.98} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.styleName}>{vehicleStyleName(draft.style)}</Text>

      <Text style={styles.colorTitle}>Color</Text>
      <Text style={styles.colorName}>{vehicleColorName(draft.color)}</Text>
      <View style={styles.swatches}>
        {VEHICLE_COLORS.map(({ color, hex, label }) => {
          const selected = draft.color === color;
          return (
            <Pressable
              key={color}
              style={[styles.swatchRing, selected && styles.swatchRingOn]}
              onPress={() => setDraft((d) => ({ ...d, color }))}
              accessibilityRole="button"
              accessibilityLabel={`Colour: ${label}`}
              accessibilityState={{ selected }}
            >
              <View style={[styles.swatch, { backgroundColor: hex }]} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.buttons}>
        <Pressable style={[styles.button, styles.reset]} onPress={() => setDraft(DEFAULT_VEHICLE)} accessibilityRole="button">
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.done]} onPress={() => onDone(draft)} accessibilityRole="button">
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#121212',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 22,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  title: { color: '#f4f4f5', fontSize: 24, fontWeight: '500' },
  close: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#2a2a2d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f4f4f5', fontSize: 22 },
  item: { height: 190, alignItems: 'center', justifyContent: 'flex-end' },
  platform: { position: 'absolute', bottom: 18 },
  art: { marginBottom: 22 },
  artDim: { opacity: 0.85, transform: [{ scale: 0.86 }] },
  styleName: { color: '#a1a1aa', fontSize: 15, textAlign: 'center', marginTop: -4 },
  colorTitle: { color: '#f4f4f5', fontSize: 22, textAlign: 'center', marginTop: 18 },
  colorName: { color: '#a1a1aa', fontSize: 17, textAlign: 'center', marginTop: 4 },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 14,
    columnGap: 18,
    paddingHorizontal: 20,
    marginTop: 18,
  },
  swatchRing: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  swatchRingOn: { borderColor: TEAL },
  swatch: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#3f3f46' },
  buttons: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 24 },
  button: { flex: 1, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  reset: { backgroundColor: '#0b4f5c' },
  resetText: { color: '#a5e3ee', fontSize: 18, fontWeight: '600' },
  done: { backgroundColor: TEAL },
  doneText: { color: '#06262d', fontSize: 18, fontWeight: '600' },
});
