import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { formatClockTime } from '@/lib/format';
import { haversineMeters } from '@/lib/geo';
import { t } from '@/lib/i18n';
import { placeIcon } from '@/lib/places';
import { supabase } from '@/lib/supabase';
import { colors, spacing, themed, useThemeVersion } from '@/lib/theme';
import { buildTimeline, milesText, spanText, type Ping, type TimelineEntry } from '@/lib/timeline';

interface Place {
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

// Today for one person, on their details screen (lib/timeline.ts): where they
// stayed and how they got between places. Opening that screen already
// records the look in their "Who's checked on me", so this adds no new reach.
export function DayTimeline({ userId, circleId }: { userId: string; circleId: string | null }) {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [names, setNames] = useState<Record<number, { icon: string; text: string }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const [{ data: pings }, { data: places }] = await Promise.all([
        supabase
          .from('locations')
          .select('latitude, longitude, speed, recorded_at')
          .eq('user_id', userId)
          .gte('recorded_at', midnight.toISOString())
          .order('recorded_at', { ascending: true })
          .limit(3000),
        circleId
          ? supabase.from('places').select('name, latitude, longitude, radius_meters').eq('circle_id', circleId)
          : Promise.resolve({ data: [] as Place[] }),
      ]);
      if (!alive) return;
      const tl = buildTimeline((pings as Ping[] | null) ?? []);
      setEntries(tl);

      // name each stay: a saved place, else the street from the phone's geocoder
      const found: Record<number, { icon: string; text: string }> = {};
      for (const [i, e] of tl.entries()) {
        if (e.kind !== 'stay') continue;
        const place = ((places as Place[] | null) ?? []).find(
          (p) => haversineMeters(p.latitude, p.longitude, e.latitude, e.longitude) <= p.radius_meters,
        );
        if (place) {
          found[i] = { icon: placeIcon(place.name), text: place.name };
          continue;
        }
        try {
          const [a] = await Location.reverseGeocodeAsync({ latitude: e.latitude, longitude: e.longitude });
          const street = a ? [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name : null;
          if (street) found[i] = { icon: '📍', text: t('Near {street}', { street }) };
        } catch {
          // left as "A stop"
        }
      }
      if (alive) setNames(found);
    })();
    return () => {
      alive = false;
    };
  }, [userId, circleId]);

  if (!entries) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title} accessibilityRole="header">{t('Today')}</Text>
      {entries.length === 0 && <Text style={styles.empty}>{t('No locations shared today yet.')}</Text>}
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        if (e.kind === 'stay') {
          const name = names[i] ?? { icon: '📍', text: t('A stop') };
          return (
            <View key={i} style={styles.row} accessible>
              <View style={styles.rail}>
                <View style={[styles.dot, e.ongoing && styles.dotNow]}>
                  <Text allowFontScaling={false} style={styles.dotIcon}>{name.icon}</Text>
                </View>
                {!last && <View style={styles.line} />}
              </View>
              <View style={styles.body}>
                <Text style={styles.stayName} numberOfLines={1}>{name.text}</Text>
                <Text style={styles.sub}>
                  {formatClockTime(e.start)} – {e.ongoing ? t('now') : formatClockTime(e.end)} · {spanText(e.start, e.end)}
                </Text>
              </View>
            </View>
          );
        }
        return (
          <View key={i} style={styles.row} accessible>
            <View style={styles.rail}>
              <View style={styles.moveDot} />
              {!last && <View style={[styles.line, styles.lineMove]} />}
            </View>
            <View style={[styles.body, styles.moveBody]}>
              <Text style={styles.moveText}>
                {e.drove ? '🚗 ' : '🚶 '}
                {e.drove
                  ? t('Drove {time}', { time: spanText(e.start, e.end) })
                  : t('Moved {time}', { time: spanText(e.start, e.end) })}
                {' · '}
                {milesText(e.meters)}
                {e.drove && e.topMph != null ? ` · ${t('top {mph} mph', { mph: e.topMph })}` : ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DOT = 30;
const styles = themed(() => StyleSheet.create({
  wrap: { gap: 0, marginTop: spacing.sm },
  title: { fontSize: 13, fontWeight: '700', color: colors.text, letterSpacing: 0.6, marginBottom: spacing.sm, textTransform: 'uppercase' },
  empty: { fontSize: 14, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.md },
  rail: { width: DOT, alignItems: 'center' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.tint,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotNow: { backgroundColor: colors.accentFill },
  dotIcon: { fontSize: 14 },
  moveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border, marginTop: 6 },
  line: { flex: 1, width: 2, backgroundColor: colors.accent, opacity: 0.4, minHeight: 14 },
  lineMove: { opacity: 0.25 },
  body: { flex: 1, paddingBottom: spacing.md, gap: 2, paddingTop: 4 },
  moveBody: { paddingTop: 2 },
  stayName: { fontSize: 16, fontWeight: '700', color: colors.textHeading },
  sub: { fontSize: 13, color: colors.text },
  moveText: { fontSize: 13, color: colors.text },
}));
