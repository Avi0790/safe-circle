import { useId } from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';
import { CX, CY, SHAPES, VehicleIcon, VH, VW } from '@/components/VehicleIcon';
import { shade, vehicleHex, type VehicleColor, type VehicleStyle } from '@/lib/vehiclePreference';

// The driving avatar as a stack of horizontal slices ("sprite stacking"):
// shadow and headlight beams on the road, wheels, darker body sides, the
// car's top at waist height, a band of windows, then the roof. Looking
// straight down they line up into the normal top-down car; as the map tilts,
// each slice is lifted up the screen by its height (TiltedAvatar.tsx), so the
// car's sides, windows and wheels show from whichever way it's facing.
export type SlicePart = 'ground' | 'tyres' | 'body' | 'deck' | 'cabin' | 'roof' | 'spoiler' | 'helmet' | 'wing';

export interface Slice {
  z: number; // height above the road, in drawing units (the car is ~24 wide)
  part: SlicePart;
  tone?: number; // body slices: how much darker than the paint (towards the road); cabin: 0 at the bottom of the windows to 1 at the top
}

// Height of the beltline (where the car's top is drawn) and of the roof.
const HEIGHTS: Record<Exclude<VehicleStyle, 'arrow' | 'race'>, { belt: number; roof: number }> = {
  sports: { belt: 6, roof: 11 },
  compact: { belt: 8, roof: 17 },
  classic: { belt: 8, roof: 15 },
  sedan: { belt: 8, roof: 15 },
  offroad: { belt: 11, roof: 20 },
};

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let z = from; z <= to + 1e-9; z += step) out.push(Math.round(z * 10) / 10);
  return out;
};

// Bottom to top: drawn in this order, so a higher slice always covers a lower
// one (sorted by height; slices at the same height keep their listed order).
export function carSlices(style: VehicleStyle): Slice[] {
  return unsortedSlices(style)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.z - b.s.z || a.i - b.i)
    .map(({ s }) => s);
}

function unsortedSlices(style: VehicleStyle): Slice[] {
  if (style === 'arrow') return [];
  if (style === 'race') {
    return [
      { z: 0, part: 'ground' },
      ...range(0.5, 6, 1.5).map((z) => ({ z, part: 'tyres' as const })),
      ...range(1.5, 3, 1.5).map((z) => ({ z, part: 'body' as const, tone: -0.45 })),
      { z: 4, part: 'deck' },
      { z: 6, part: 'helmet' },
      { z: 8, part: 'wing' },
    ];
  }
  const h = HEIGHTS[style];
  const bodyZ = range(1.5, h.belt - 1, 1.5);
  const cabinZ = range(h.belt + 1.2, h.roof - 1, 1.5);
  return [
    { z: 0, part: 'ground' },
    ...range(0.5, 3.5, 1.5).map((z) => ({ z, part: 'tyres' as const })),
    ...bodyZ.map((z, i) => ({ z, part: 'body' as const, tone: -0.6 + (0.4 * i) / Math.max(1, bodyZ.length - 1) })),
    { z: h.belt, part: 'deck' },
    ...(style === 'sports' ? [{ z: h.belt + 2.5, part: 'spoiler' as const }] : []),
    ...cabinZ.map((z, i) => ({ z, part: 'cabin' as const, tone: i / Math.max(1, cabinZ.length - 1) })),
    { z: h.roof, part: 'roof' },
  ];
}

// One slice, drawn in the same frame as VehicleIcon so they line up.
export function CarSlice({ style, color, slice, lights = true }: { style: VehicleStyle; color: VehicleColor; slice: Slice; lights?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const hex = vehicleHex(color);
  const frame = (children: React.ReactNode) => (
    <Svg width={VW} height={VH} viewBox={`0 0 ${VW} ${VH}`}>
      {children}
    </Svg>
  );

  if (slice.part === 'deck') return <VehicleIcon style={style} color={color} lights={false} parts="deck" />;

  if (style === 'race') {
    const y0 = CY - 28;
    switch (slice.part) {
      case 'ground':
        return frame(
          <>
            <Defs>
              <LinearGradient id={`beam${uid}`} x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor="#ffe08a" stopOpacity="0.5" />
                <Stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            {lights && <Polygon points={`${CX - 4},${y0 + 2} ${CX + 4},${y0 + 2} ${CX + 12},${y0 - 30} ${CX - 12},${y0 - 30}`} fill={`url(#beam${uid})`} />}
            <Rect x={CX - 17} y={y0 + 2} width="34" height="58" rx="10" fill="#000" opacity="0.3" />
          </>,
        );
      case 'tyres':
        return frame(
          <G fill="#0d0d0f">
            <Rect x={CX - 18} y={y0 + 8} width="7" height="12" rx="2.5" />
            <Rect x={CX + 11} y={y0 + 8} width="7" height="12" rx="2.5" />
            <Rect x={CX - 19} y={y0 + 38} width="8" height="14" rx="3" />
            <Rect x={CX + 11} y={y0 + 38} width="8" height="14" rx="3" />
          </G>,
        );
      case 'body':
        return frame(<Rect x={CX - 10} y={y0 + 6} width="20" height="46" rx="6" fill={shade(hex, slice.tone ?? -0.4)} />);
      case 'helmet':
        return frame(<Circle cx={CX} cy={y0 + 26} r="3.2" fill="#ffcc00" stroke="#ffffff" strokeWidth="0.6" />);
      case 'wing':
        return frame(
          <G>
            <Rect x={CX - 13} y={y0 + 54} width="26" height="5" rx="1.5" fill={shade(hex, -0.45)} />
            <Rect x={CX - 6} y={y0 + 56} width="12" height="1.6" fill="#ef4444" />
          </G>,
        );
      default:
        return null;
    }
  }

  if (style === 'arrow') return null;
  const s = SHAPES[style];
  const x0 = CX - s.W / 2;
  const y0 = CY - s.L / 2;
  const glassTop = y0 + s.ws;
  const roofTop = glassTop + s.wl;
  const rearTop = roofTop + s.rl;
  const cabinEnd = rearTop + s.rwl;
  const tyre = s.extras?.fatTyres ? 5.5 : 4;

  switch (slice.part) {
    case 'ground':
      return frame(
        <>
          <Defs>
            <LinearGradient id={`beam${uid}`} x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0" stopColor="#ffe08a" stopOpacity="0.55" />
              <Stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          {lights && (
            <Polygon
              points={`${x0 + 3},${y0 + 3} ${x0 + s.W - 3},${y0 + 3} ${x0 + s.W + 8},${Math.max(2, y0 - 36)} ${x0 - 8},${Math.max(2, y0 - 36)}`}
              fill={`url(#beam${uid})`}
            />
          )}
          <Rect x={x0 - 1} y={y0 + 2} width={s.W + 4} height={s.L + 3} rx={s.r + 2} fill="#000" opacity="0.32" />
        </>,
      );
    case 'tyres':
      return frame(
        <G fill="#0d0d0f">
          <Rect x={x0 - tyre / 2} y={y0 + s.L * 0.15} width={tyre} height="10" rx="2" />
          <Rect x={x0 + s.W - tyre / 2} y={y0 + s.L * 0.15} width={tyre} height="10" rx="2" />
          <Rect x={x0 - tyre / 2} y={y0 + s.L * 0.72} width={tyre} height="10" rx="2" />
          <Rect x={x0 + s.W - tyre / 2} y={y0 + s.L * 0.72} width={tyre} height="10" rx="2" />
          {s.extras?.spare && <Circle cx={CX} cy={y0 + s.L + 1} r="5" stroke="#3f3f46" strokeWidth="1" />}
        </G>,
      );
    case 'body':
      return frame(<Rect x={x0} y={y0} width={s.W} height={s.L} rx={s.r} fill={shade(hex, slice.tone ?? -0.4)} />);
    case 'spoiler':
      return frame(<Rect x={x0 - 2} y={y0 + s.L - 4} width={s.W + 4} height="3.2" rx="1.2" fill="#121214" />);
    case 'cabin':
      // the band of windows, a little lighter towards the top (no outline:
      // stacked outlines read as stripes)
      return frame(
        <Rect x={x0 + 3} y={glassTop} width={s.W - 6} height={cabinEnd - glassTop} rx="3" fill={shade('#14505e', 0.35 * (slice.tone ?? 0))} />,
      );
    case 'roof':
      return frame(
        <>
          <Defs>
            <LinearGradient id={`roof${uid}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={shade(hex, -0.15)} />
              <Stop offset="0.5" stopColor={shade(hex, 0.3)} />
              <Stop offset="1" stopColor={shade(hex, -0.15)} />
            </LinearGradient>
          </Defs>
          <Rect x={x0 + 3.5} y={roofTop} width={s.W - 7} height={s.rl} rx="2.5" fill={`url(#roof${uid})`} />
          {s.extras?.roofLights &&
            [-6, 0, 6].map((dx) => <Circle key={dx} cx={CX + dx} cy={roofTop + 2.5} r="1.6" fill="#fff7d6" stroke="#0d0d0f" strokeWidth="0.5" />)}
        </>,
      );
    default:
      return null;
  }
}
