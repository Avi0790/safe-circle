import { useId } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { shade, vehicleHex, type VehicleColor, type VehicleStyle } from '@/lib/vehiclePreference';
import { t } from '@/lib/i18n';

// The driving avatar seen from above, for the navigation map: shaded so the
// body looks curved, tinted glass, headlight beams fading out ahead and red
// taillights. Points up; VehicleMarker.tsx lays it flat and turns it to your
// heading. The beams sit above the car and the same space below it, so the
// middle of the drawing is the middle of the car (the marker's anchor).
export const VW = 48;
export const VH = 128;
export const CX = VW / 2;
export const CY = VH / 2;

export interface Shape {
  L: number; // length
  W: number; // width
  r: number; // corner rounding
  ws: number; // windshield starts this far from the nose
  wl: number; // windshield length
  rl: number; // roof length
  rwl: number; // rear window length
  extras?: { spoiler?: boolean; chrome?: boolean; roofLights?: boolean; spare?: boolean; fatTyres?: boolean };
}

export const SHAPES: Record<Exclude<VehicleStyle, 'arrow' | 'race'>, Shape> = {
  sports: { L: 54, W: 24, r: 10, ws: 17, wl: 9, rl: 10, rwl: 6, extras: { spoiler: true } },
  compact: { L: 44, W: 24, r: 8, ws: 10, wl: 8, rl: 17, rwl: 4 },
  classic: { L: 56, W: 24, r: 5, ws: 15, wl: 7, rl: 16, rwl: 6, extras: { chrome: true } },
  sedan: { L: 58, W: 25, r: 9, ws: 16, wl: 9, rl: 17, rwl: 7 },
  offroad: { L: 56, W: 28, r: 5, ws: 12, wl: 8, rl: 20, rwl: 4, extras: { roofLights: true, spare: true, fatTyres: true } },
};

export function VehicleIcon({
  style,
  color,
  walking = false,
  lights = true,
  size = 1,
  parts = 'all',
}: {
  style: VehicleStyle;
  color: VehicleColor;
  walking?: boolean;
  lights?: boolean;
  // 1 = map size; previews can draw it bigger
  size?: number;
  // 'deck': the car at waist height for the stacked 3D view (CarSlices.tsx):
  // no beams, shadow or tyres, which are drawn on their own lower layers
  parts?: 'all' | 'deck';
}) {
  const all = parts === 'all';
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const hex = vehicleHex(color);
  const id = (name: string) => `${name}${uid}`;

  if (walking || style === 'arrow') {
    const fill = walking ? '#16a34a' : color === 'white' ? '#1a8cff' : hex;
    return (
      <Svg width={56 * size} height={56 * size} viewBox="0 0 56 56" accessibilityLabel={walking ? 'You (walking)' : 'You'}>
        <Defs>
          <RadialGradient id={id('halo')} cx="50%" cy="50%" r="50%">
            <Stop offset="0.55" stopColor={fill} stopOpacity="0.35" />
            <Stop offset="1" stopColor={fill} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id={id('arrow')} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={shade(fill, 0.25)} />
            <Stop offset="1" stopColor={shade(fill, -0.25)} />
          </LinearGradient>
        </Defs>
        <Circle cx="28" cy="28" r="28" fill={`url(#${id('halo')})`} />
        <Circle cx="28" cy="29" r="15" fill="#000" opacity="0.25" />
        <Circle cx="28" cy="28" r="15" fill="#ffffff" />
        <Path d="M28 15 L38 37 L28 32 L18 37 Z" fill={`url(#${id('arrow')})`} stroke={shade(fill, -0.4)} strokeWidth="0.8" />
      </Svg>
    );
  }

  const w = VW * size;
  const h = VH * size;

  if (style === 'race') {
    const accent = shade(hex, -0.45);
    const y0 = CY - 28;
    return (
      <Svg width={w} height={h} viewBox={`0 0 ${VW} ${VH}`} accessibilityLabel={t('You')}>
        <Defs>
          <LinearGradient id={id('beam')} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#ffe08a" stopOpacity="0.5" />
            <Stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={shade(hex, -0.35)} />
            <Stop offset="0.5" stopColor={shade(hex, 0.2)} />
            <Stop offset="1" stopColor={shade(hex, -0.35)} />
          </LinearGradient>
        </Defs>
        {all && lights && <Polygon points={`${CX - 4},${y0 + 2} ${CX + 4},${y0 + 2} ${CX + 12},${y0 - 30} ${CX - 12},${y0 - 30}`} fill={`url(#${id('beam')})`} />}
        {all && <Ellipse cx={CX + 1} cy={CY + 2} rx="16" ry="31" fill="#000" opacity="0.3" />}
        {/* front wing, wheels, rear wing */}
        <Rect x={CX - 15} y={y0 + 1} width="30" height="4" rx="1.5" fill={accent} />
        {all && (
          <G fill="#0d0d0f">
            <Rect x={CX - 18} y={y0 + 8} width="7" height="12" rx="2.5" />
            <Rect x={CX + 11} y={y0 + 8} width="7" height="12" rx="2.5" />
            <Rect x={CX - 19} y={y0 + 38} width="8" height="14" rx="3" />
            <Rect x={CX + 11} y={y0 + 38} width="8" height="14" rx="3" />
          </G>
        )}
        <Path
          d={`M${CX} ${y0} Q${CX + 4} ${y0 + 4} ${CX + 4} ${y0 + 16} L${CX + 10} ${y0 + 30} L${CX + 10} ${y0 + 50} Q${CX} ${y0 + 56} ${CX - 10} ${y0 + 50} L${CX - 10} ${y0 + 30} L${CX - 4} ${y0 + 16} Q${CX - 4} ${y0 + 4} ${CX} ${y0} Z`}
          fill={`url(#${id('body')})`}
          stroke={accent}
          strokeWidth="0.6"
        />
        <Rect x={CX - 1.2} y={y0 + 4} width="2.4" height="44" fill={accent} opacity="0.6" />
        {/* cockpit and helmet */}
        <Ellipse cx={CX} cy={y0 + 27} rx="4.5" ry="7" fill="#0d0d0f" />
        <Circle cx={CX} cy={y0 + 26} r="3.2" fill="#ffcc00" stroke="#ffffff" strokeWidth="0.6" />
        <Rect x={CX - 13} y={y0 + 54} width="26" height="5" rx="1.5" fill={accent} />
        <Rect x={CX - 6} y={y0 + 56} width="12" height="1.6" fill="#ef4444" />
      </Svg>
    );
  }

  const s = SHAPES[style];
  const x0 = CX - s.W / 2;
  const y0 = CY - s.L / 2;
  const ext = s.extras ?? {};
  const glassTop = y0 + s.ws;
  const roofTop = glassTop + s.wl;
  const rearTop = roofTop + s.rl;
  const tyre = ext.fatTyres ? 5.5 : 4;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${VW} ${VH}`} accessibilityLabel={t('You')}>
      <Defs>
        <LinearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={shade(hex, -0.4)} />
          <Stop offset="0.2" stopColor={shade(hex, -0.06)} />
          <Stop offset="0.5" stopColor={shade(hex, 0.22)} />
          <Stop offset="0.8" stopColor={shade(hex, -0.06)} />
          <Stop offset="1" stopColor={shade(hex, -0.4)} />
        </LinearGradient>
        <LinearGradient id={id('glass')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#a5f3fc" />
          <Stop offset="1" stopColor="#0e6f86" />
        </LinearGradient>
        <LinearGradient id={id('roof')} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={shade(hex, -0.15)} />
          <Stop offset="0.5" stopColor={shade(hex, 0.3)} />
          <Stop offset="1" stopColor={shade(hex, -0.15)} />
        </LinearGradient>
        <LinearGradient id={id('beam')} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#ffe08a" stopOpacity="0.55" />
          <Stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
        </LinearGradient>
      </Defs>

      {all && lights && (
        <Polygon
          points={`${x0 + 3},${y0 + 3} ${x0 + s.W - 3},${y0 + 3} ${x0 + s.W + 8},${Math.max(2, y0 - 36)} ${x0 - 8},${Math.max(2, y0 - 36)}`}
          fill={`url(#${id('beam')})`}
        />
      )}
      {/* shadow on the road */}
      {all && <Rect x={x0 - 1} y={y0 + 2} width={s.W + 4} height={s.L + 3} rx={s.r + 2} fill="#000" opacity="0.32" />}
      {/* tyres just showing past the body */}
      <G fill="#0d0d0f" opacity={all ? 1 : 0}>
        <Rect x={x0 - tyre / 2} y={y0 + s.L * 0.15} width={tyre} height="10" rx="2" />
        <Rect x={x0 + s.W - tyre / 2} y={y0 + s.L * 0.15} width={tyre} height="10" rx="2" />
        <Rect x={x0 - tyre / 2} y={y0 + s.L * 0.72} width={tyre} height="10" rx="2" />
        <Rect x={x0 + s.W - tyre / 2} y={y0 + s.L * 0.72} width={tyre} height="10" rx="2" />
      </G>
      {all && ext.spare && <Circle cx={CX} cy={y0 + s.L + 1} r="5" fill="#0d0d0f" stroke="#3f3f46" strokeWidth="1" />}
      {/* mirrors */}
      <Ellipse cx={x0 - 1} cy={glassTop + 2} rx="2" ry="1.4" fill={shade(hex, -0.2)} />
      <Ellipse cx={x0 + s.W + 1} cy={glassTop + 2} rx="2" ry="1.4" fill={shade(hex, -0.2)} />
      {/* body */}
      <Rect x={x0} y={y0} width={s.W} height={s.L} rx={s.r} fill={`url(#${id('body')})`} stroke={shade(hex, -0.55)} strokeWidth="0.6" />
      {/* bonnet shine */}
      <Ellipse cx={CX} cy={y0 + s.ws * 0.5} rx={s.W * 0.22} ry={s.ws * 0.3} fill="#ffffff" opacity="0.18" />
      {/* glass and roof */}
      <Path
        d={`M${x0 + 5} ${glassTop} L${x0 + s.W - 5} ${glassTop} L${x0 + s.W - 3} ${roofTop} L${x0 + 3} ${roofTop} Z`}
        fill={`url(#${id('glass')})`}
      />
      <Rect x={x0 + 3.5} y={roofTop} width={s.W - 7} height={s.rl} rx="2.5" fill={`url(#${id('roof')})`} />
      {ext.roofLights &&
        [-6, 0, 6].map((dx) => <Circle key={dx} cx={CX + dx} cy={roofTop + 2.5} r="1.6" fill="#fff7d6" stroke="#0d0d0f" strokeWidth="0.5" />)}
      <Path
        d={`M${x0 + 3} ${rearTop} L${x0 + s.W - 3} ${rearTop} L${x0 + s.W - 5} ${rearTop + s.rwl} L${x0 + 5} ${rearTop + s.rwl} Z`}
        fill={`url(#${id('glass')})`}
        opacity="0.85"
      />
      {/* lights */}
      <Ellipse cx={x0 + 4.5} cy={y0 + 2.2} rx="3" ry="1.4" fill="#fffbe6" />
      <Ellipse cx={x0 + s.W - 4.5} cy={y0 + 2.2} rx="3" ry="1.4" fill="#fffbe6" />
      <Rect x={x0 + 2.5} y={y0 + s.L - 2.6} width="5" height="1.8" rx="0.9" fill="#ff3b3b" />
      <Rect x={x0 + s.W - 7.5} y={y0 + s.L - 2.6} width="5" height="1.8" rx="0.9" fill="#ff3b3b" />
      {ext.chrome && (
        <G fill="#e5e7eb">
          <Rect x={x0 + 1} y={y0 - 1.2} width={s.W - 2} height="2" rx="1" />
          <Rect x={x0 + 1} y={y0 + s.L - 0.8} width={s.W - 2} height="2" rx="1" />
        </G>
      )}
      {ext.spoiler && <Rect x={x0 - 2} y={y0 + s.L - 4} width={s.W + 4} height="3.2" rx="1.2" fill="#121214" />}
    </Svg>
  );
}
