import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { VehicleIcon } from '@/components/VehicleIcon';
import { shade, vehicleHex, type VehicleColor, type VehicleStyle } from '@/lib/vehiclePreference';
import { t } from '@/lib/i18n';

// The driving avatars as the picker shows them: a three-quarter view with a
// shaded body, tinted glass, wheels with rims, lit headlights and a shadow on
// the ground. Drawn, not 3D models, so any colour works and nothing is
// downloaded. (The map uses the top-down versions in VehicleIcon.tsx.)
const VB_W = 260;
const VB_H = 150;
const GROUND = 128;

interface Body {
  x0: number; // front
  x1: number; // rear
  hoodY: number;
  beltY: number;
  bottomY: number;
  roofY: number;
  cabinFront: number;
  roofFront: number;
  roofRear: number;
  cabinRear: number;
  wheelR: number;
  wf: number; // front wheel centre x
  wr: number; // rear wheel centre x
  boxy?: boolean;
  spoiler?: boolean;
  chrome?: boolean;
  roofLights?: boolean;
  roundLights?: boolean;
  knobbly?: boolean;
}

const BODIES: Record<Exclude<VehicleStyle, 'arrow' | 'race'>, Body> = {
  sports: { x0: 22, x1: 236, hoodY: 94, beltY: 86, bottomY: 116, roofY: 62, cabinFront: 104, roofFront: 132, roofRear: 178, cabinRear: 214, wheelR: 18, wf: 70, wr: 196, spoiler: true },
  compact: { x0: 54, x1: 206, hoodY: 82, beltY: 76, bottomY: 114, roofY: 40, cabinFront: 84, roofFront: 102, roofRear: 190, cabinRear: 200, wheelR: 17, wf: 86, wr: 178, boxy: true },
  classic: { x0: 30, x1: 230, hoodY: 84, beltY: 80, bottomY: 114, roofY: 50, cabinFront: 96, roofFront: 112, roofRear: 178, cabinRear: 194, wheelR: 16, wf: 74, wr: 192, chrome: true, roundLights: true },
  sedan: { x0: 26, x1: 234, hoodY: 86, beltY: 76, bottomY: 116, roofY: 48, cabinFront: 94, roofFront: 120, roofRear: 184, cabinRear: 212, wheelR: 17, wf: 72, wr: 198 },
  offroad: { x0: 34, x1: 228, hoodY: 74, beltY: 68, bottomY: 106, roofY: 36, cabinFront: 84, roofFront: 98, roofRear: 172, cabinRear: 178, wheelR: 22, wf: 78, wr: 188, boxy: true, roofLights: true, knobbly: true },
};

export function AvatarArt({ style, color, width = 220 }: { style: VehicleStyle; color: VehicleColor; width?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `${name}${uid}`;
  const hex = vehicleHex(color);
  const height = (width * VB_H) / VB_W;

  if (style === 'arrow') {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={t('Navigation arrow')}>
        <VehicleIcon style="arrow" color={color} size={(height / 56) * 0.85} lights={false} />
      </View>
    );
  }

  const defs = (
    <Defs>
      <LinearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={shade(hex, 0.32)} />
        <Stop offset="0.45" stopColor={hex} />
        <Stop offset="1" stopColor={shade(hex, -0.5)} />
      </LinearGradient>
      <LinearGradient id={id('roof')} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={shade(hex, 0.15)} />
        <Stop offset="1" stopColor={shade(hex, -0.35)} />
      </LinearGradient>
      <LinearGradient id={id('glass')} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#8ae8fb" />
        <Stop offset="1" stopColor="#0b5f74" />
      </LinearGradient>
      <RadialGradient id={id('rim')} cx="45%" cy="40%" r="60%">
        <Stop offset="0" stopColor="#f4f4f5" />
        <Stop offset="1" stopColor="#71717a" />
      </RadialGradient>
      <RadialGradient id={id('glow')} cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
        <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </RadialGradient>
    </Defs>
  );

  const wheel = (cx: number, r: number, front: boolean, knobbly = false) => {
    const cy = GROUND - r;
    const rx = front ? r * 0.88 : r;
    return (
      <G key={`${cx}`}>
        <Ellipse cx={cx} cy={cy} rx={rx} ry={r} fill="#0d0d0f" stroke={knobbly ? '#27272a' : 'none'} strokeWidth={knobbly ? 3 : 0} strokeDasharray={knobbly ? '3 2' : undefined} />
        <Ellipse cx={cx} cy={cy} rx={rx * 0.62} ry={r * 0.62} fill={`url(#${id('rim')})`} />
        {[0, 72, 144, 216, 288].map((a) => (
          <Line
            key={a}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos((a * Math.PI) / 180) * rx * 0.58}
            y2={cy + Math.sin((a * Math.PI) / 180) * r * 0.58}
            stroke="#52525b"
            strokeWidth="2"
          />
        ))}
        <Ellipse cx={cx} cy={cy} rx={rx * 0.16} ry={r * 0.16} fill="#3f3f46" />
      </G>
    );
  };

  if (style === 'race') {
    const accent = shade(hex, -0.5);
    return (
      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} accessibilityLabel={t('Race car')}>
        {defs}
        <Ellipse cx="128" cy="129" rx="118" ry="8" fill="#000" opacity="0.5" />
        {/* rear wing */}
        <Rect x="214" y="74" width="4" height="34" fill="#18181b" />
        <Rect x="204" y="62" width="40" height="9" rx="2" fill={hex} stroke={accent} strokeWidth="1" />
        {/* body: nose, sidepods, engine cover */}
        <Path d="M16 108 L58 100 L100 94 Q118 88 142 88 L200 86 L218 92 L218 104 L58 112 Z" fill={`url(#${id('body')})`} stroke={accent} strokeWidth="1" />
        <Path d="M138 88 Q150 66 170 66 L202 84 Z" fill={`url(#${id('roof')})`} />
        <Path d="M30 106 L100 98" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2" />
        <Rect x="150" y="92" width="44" height="6" rx="3" fill={accent} opacity="0.7" />
        {/* cockpit, halo, helmet */}
        <Ellipse cx="126" cy="89" rx="16" ry="5" fill="#0d0d0f" />
        <Circle cx="124" cy="81" r="7" fill="#ffcc00" stroke="#ffffff" strokeWidth="1.2" />
        <Rect x="119" y="79" width="9" height="3" rx="1.5" fill="#0d0d0f" />
        <Path d="M108 86 Q124 70 142 86" stroke="#18181b" strokeWidth="3" fill="none" />
        {/* front wing */}
        <Rect x="6" y="112" width="58" height="6" rx="2" fill={accent} />
        <Rect x="6" y="104" width="4" height="14" fill={hex} />
        {wheel(196, 22, false)}
        {wheel(70, 18, true)}
      </Svg>
    );
  }

  const b = BODIES[style];
  const rr = b.boxy ? 5 : 13;
  const body = [
    `M${b.x0 + rr} ${b.bottomY}`,
    `Q${b.x0} ${b.bottomY} ${b.x0} ${b.bottomY - rr}`,
    `L${b.x0} ${b.hoodY + 6}`,
    `Q${b.x0} ${b.hoodY} ${b.x0 + 10} ${b.hoodY - 2}`,
    `L${b.cabinFront} ${b.beltY}`,
    `L${b.x1 - 14} ${b.beltY - 2}`,
    `Q${b.x1} ${b.beltY} ${b.x1} ${b.beltY + 10}`,
    `L${b.x1} ${b.bottomY - rr}`,
    `Q${b.x1} ${b.bottomY} ${b.x1 - rr} ${b.bottomY}`,
    'Z',
  ].join(' ');
  const cabin = `M${b.cabinFront} ${b.beltY} L${b.roofFront} ${b.roofY + 2} Q${b.roofFront + 6} ${b.roofY - 2} ${b.roofFront + 16} ${b.roofY - 2} L${b.roofRear - 8} ${b.roofY - 1} Q${b.roofRear} ${b.roofY} ${b.roofRear + 5} ${b.roofY + 5} L${b.cabinRear} ${b.beltY - 2} Z`;
  const windshield = `M${b.cabinFront + 6} ${b.beltY - 1} L${b.roofFront + 3} ${b.roofY + 4} L${b.roofFront + 18} ${b.roofY + 1} L${b.cabinFront + 28} ${b.beltY - 1} Z`;
  const side = `M${b.cabinFront + 33} ${b.beltY - 2} L${b.roofFront + 23} ${b.roofY + 2} L${b.roofRear - 6} ${b.roofY + 2} L${b.cabinRear - 7} ${b.beltY - 3} Z`;
  const doorX = (b.cabinFront + b.cabinRear) / 2 + 6;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} accessibilityLabel={t('Car')}>
      {defs}
      <Ellipse cx={(b.x0 + b.x1) / 2} cy={GROUND + 1} rx={(b.x1 - b.x0) / 2 + 10} ry="8" fill="#000" opacity="0.5" />
      {b.roofLights && (
        <G>
          <Rect x={b.roofFront + 10} y={b.roofY - 9} width="50" height="3" rx="1.5" fill="#18181b" />
          {[0, 1, 2].map((i) => (
            <Circle key={i} cx={b.roofFront + 18 + i * 17} cy={b.roofY - 12} r="5" fill="#fffbe6" stroke="#18181b" strokeWidth="1.5" />
          ))}
        </G>
      )}
      <Path d={cabin} fill={`url(#${id('roof')})`} />
      <Path d={windshield} fill={`url(#${id('glass')})`} />
      <Path d={side} fill={`url(#${id('glass')})`} />
      <Line x1={(b.roofFront + b.roofRear) / 2 + 4} y1={b.roofY + 2} x2={doorX} y2={b.beltY - 2} stroke={shade(hex, -0.4)} strokeWidth="3" />
      {/* wheel arches, then the body over them */}
      <Circle cx={b.wf} cy={GROUND - b.wheelR} r={b.wheelR + 4} fill={shade(hex, -0.7)} />
      <Circle cx={b.wr} cy={GROUND - b.wheelR} r={b.wheelR + 4} fill={shade(hex, -0.7)} />
      <Path d={body} fill={`url(#${id('body')})`} stroke={shade(hex, -0.6)} strokeWidth="1" />
      <Circle cx={b.wf} cy={GROUND - b.wheelR} r={b.wheelR + 3} fill={shade(hex, -0.75)} />
      <Circle cx={b.wr} cy={GROUND - b.wheelR} r={b.wheelR + 3} fill={shade(hex, -0.75)} />
      {/* shine along the shoulder and bonnet, door line and handle */}
      <Path d={`M${b.x0 + 14} ${b.hoodY + 1} L${b.cabinFront} ${b.beltY + 3} L${b.x1 - 16} ${b.beltY + 1}`} stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2" fill="none" />
      <Line x1={doorX} y1={b.beltY + 4} x2={doorX - 2} y2={b.bottomY - 10} stroke={shade(hex, -0.45)} strokeWidth="1.5" />
      <Rect x={doorX + 8} y={b.beltY + 8} width="10" height="2.5" rx="1.2" fill={shade(hex, -0.5)} />
      {/* front: grille and headlights (the far one smaller, for depth) */}
      <Rect x={b.x0 + 3} y={b.hoodY + 12} width="17" height="8" rx="3" fill="#18181b" />
      {b.roundLights ? (
        <>
          <Circle cx={b.x0 + 11} cy={b.hoodY + 6} r="5" fill="#fffbe6" stroke="#d4d4d8" strokeWidth="1.5" />
          <Circle cx={b.x0 + 26} cy={b.hoodY + 3} r="3.5" fill="#fffbe6" stroke="#d4d4d8" strokeWidth="1" />
        </>
      ) : (
        <>
          <Ellipse cx={b.x0 + 10} cy={b.hoodY + 6} rx="7" ry="2.8" fill="#fffbe6" />
          <Ellipse cx={b.x0 + 26} cy={b.hoodY + 3} rx="4.5" ry="2" fill="#fffbe6" />
        </>
      )}
      <Circle cx={b.x0 + 8} cy={b.hoodY + 6} r="14" fill={`url(#${id('glow')})`} opacity="0.55" />
      {/* taillight */}
      <Rect x={b.x1 - 4} y={b.beltY + 8} width="4" height="9" rx="2" fill="#ef4444" />
      {b.chrome && (
        <G fill="#e4e4e7">
          <Rect x={b.x0 - 3} y={b.bottomY - 9} width="22" height="5" rx="2.5" />
          <Rect x={b.x1 - 16} y={b.bottomY - 9} width="19" height="5" rx="2.5" />
        </G>
      )}
      {b.spoiler && (
        <G fill="#18181b">
          <Rect x={b.x1 - 20} y={b.beltY - 6} width="4" height="8" />
          <Path d={`M${b.x1 - 30} ${b.beltY - 8} L${b.x1 + 8} ${b.beltY - 16} L${b.x1 + 8} ${b.beltY - 9} L${b.x1 - 28} ${b.beltY - 3} Z`} />
        </G>
      )}
      {wheel(b.wr, b.wheelR, false, b.knobbly)}
      {wheel(b.wf, b.wheelR, true, b.knobbly)}
    </Svg>
  );
}
