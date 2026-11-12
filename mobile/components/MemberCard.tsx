import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/Avatar';
import { pinBadges } from '@/components/MemberPin';
import { announce } from '@/lib/announce';
import { externalMapsUrl } from '@/lib/externalMaps';
import { formatClockTime, getShareStatus, isLowBattery, isStale, isStatusActive, timeAgo } from '@/lib/format';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { colors, isDark, radius, spacing, themed, useThemeVersion } from '@/lib/theme';
import type { MemberWithLocation } from '@/lib/types';

// Tap someone's pin on the Map tab: this card slides up with where they are
// ("At Home", or the street they're near), how long they've been there, how
// fresh the position is, their battery and driving speed, and what you can
// do: directions, a message, a call, save their spot as a place, or open
// their details.

// The phone's own geocoder (Apple or Google), cached per spot.
interface Address {
  street: string | null; // "1815 E Highland Dr"
  area: string | null; // "Jonesboro, AR"
}
const addressCache = new Map<string, Address | null>();
const spotKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

export function formatAddress(a: Partial<Location.LocationGeocodedAddress> | undefined): Address | null {
  if (!a) return null;
  const street = [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name || null;
  const city = a.city ?? a.subregion ?? null;
  const area = [city, a.region && a.region !== city ? a.region : null].filter(Boolean).join(', ') || null;
  return street || area ? { street, area } : null;
}

function useAddress(lat: number, lng: number): Address | null {
  const key = spotKey(lat, lng);
  const [address, setAddress] = useState<Address | null>(addressCache.get(key) ?? null);
  useEffect(() => {
    if (addressCache.has(key)) {
      setAddress(addressCache.get(key) ?? null);
      return;
    }
    let alive = true;
    setAddress(null);
    Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
      .then((results) => {
        const found = formatAddress(results[0]);
        addressCache.set(key, found);
        if (alive) setAddress(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, lat, lng]);
  return address;
}

// "Tell me when they arrive / leave" alerts you've set on this person
// (migration ...000081), still waiting to fire.
interface Watch {
  id: string;
  kind: 'arrive' | 'leave';
  label: string;
}
function useWatches(targetId: string) {
  const [watches, setWatches] = useState<Watch[]>([]);
  const load = async () => {
    const { data, error } = await supabase
      .from('arrival_watches')
      .select('id, kind, label')
      .eq('target_id', targetId)
      .is('fired_at', null)
      .gt('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString());
    setWatches(!error && Array.isArray(data) ? (data as Watch[]) : []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);
  return { watches, reload: load };
}

// When they arrived at this spot (migration ...000080); null if unknown,
// or on a server without that migration yet.
function useHereSince(userId: string, recordedAt: string): string | null {
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.rpc('here_since', { p_user: userId }).then(({ data, error }) => {
      if (alive) setSince(!error && typeof data === 'string' ? data : null);
    });
    return () => {
      alive = false;
    };
  }, [userId, recordedAt]);
  return since;
}

// "48 min", "2 h 5 min", "3 h"
export function stayLength(sinceIso: string, now = Date.now()): string {
  const mins = Math.max(1, Math.round((now - new Date(sinceIso).getTime()) / 60_000));
  if (mins < 60) return t('{n} min', { n: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? t('{h} h', { h }) : t('{h} h {m} min', { h, m });
}

export function MemberCard({
  member,
  isMe,
  place,
  places = [],
  circleId,
  onPlaceSaved,
  onClose,
}: {
  member: MemberWithLocation;
  isMe: boolean;
  // the saved place they're in, if any ("At Home")
  place?: { id: string; name: string } | null;
  // the circle's places, for "tell me when they arrive at …"
  places?: { id: string; name: string }[];
  circleId: string | null;
  onPlaceSaved?: () => void;
  onClose: () => void;
}) {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const router = useRouter();
  const loc = member.location!;
  const address = useAddress(loc.latitude, loc.longitude);
  const since = useHereSince(member.id, loc.recorded_at);
  const { watches, reload: reloadWatches } = useWatches(member.id);
  const badges = pinBadges(member);
  const stale = isStale(loc.recorded_at);
  const battery = loc.battery_level != null ? Math.round(loc.battery_level * 100) : null;
  const status = [
    member.status_emoji && isStatusActive(member.status_expires_at)
      ? `${member.status_emoji} ${member.status_text ? t(member.status_text) : ''}`.trim()
      : null,
    getShareStatus(member.share_until) === 'window' && member.share_until
      ? t('sharing until {time}', { time: formatClockTime(member.share_until) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ') || null;

  // slides up when opened, or when another person is picked
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rise.setValue(0);
    Animated.spring(rise, { toValue: 1, useNativeDriver: true, bounciness: 5 }).start();
  }, [member.id, rise]);
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [280, 0] });

  const where = place
    ? t('At {place}', { place: place.name })
    : badges.mph != null
      ? t('Driving near {street}', { street: address?.street ?? address?.area ?? '…' })
      : address?.street
        ? t('Near {street}', { street: address.street })
        : address?.area ?? t('Finding the address…');

  const firstName = member.full_name.split(' ')[0] || member.full_name;

  async function setWatch(args: { kind: 'arrive' | 'leave'; place?: string; label?: string }, said: string) {
    const { error } = await supabase.rpc('create_arrival_watch', {
      p_target: member.id,
      p_kind: args.kind,
      p_place: args.place ?? null,
      p_latitude: args.place ? null : loc.latitude,
      p_longitude: args.place ? null : loc.longitude,
      p_label: args.label ?? null,
    });
    if (error) {
      Alert.alert(t("Couldn't set the alert"), t(error.message));
      return;
    }
    announce(said);
    reloadWatches();
  }

  // Choose: when they leave where they are, or when they reach one of the places.
  function notifyMe() {
    const here = place?.name ?? address?.street ?? t('here');
    const options: { text: string; onPress: () => void }[] = [
      {
        text: t('When {name} leaves {place}', { name: firstName, place: here }),
        onPress: () =>
          setWatch(
            place ? { kind: 'leave', place: place.id } : { kind: 'leave', label: here },
            t("You'll be told when {name} leaves {place}", { name: firstName, place: here }),
          ),
      },
      ...places
        .filter((p) => p.id !== place?.id)
        .slice(0, 5)
        .map((p) => ({
          text: t('When {name} gets to {place}', { name: firstName, place: p.name }),
          onPress: () =>
            setWatch({ kind: 'arrive', place: p.id }, t("You'll be told when {name} gets to {place}", { name: firstName, place: p.name })),
        })),
    ];
    Alert.alert(t('Notify me'), t('Once, in the next 24 hours.'), [...options, { text: t('Cancel'), style: 'cancel' as const, onPress: () => {} }]);
  }

  function cancelWatch(w: Watch) {
    supabase.rpc('cancel_arrival_watch', { p_id: w.id }).then(() => reloadWatches());
  }

  function savePlace() {
    if (!circleId) return;
    const save = async (name: string) => {
      const { error } = await supabase.from('places').insert({
        circle_id: circleId,
        name: name.trim() || t('Saved place'),
        latitude: loc.latitude,
        longitude: loc.longitude,
        radius_meters: 150,
      });
      if (error) {
        Alert.alert(t("Couldn't save the place"), error.message);
        return;
      }
      announce(t('Place saved'));
      onPlaceSaved?.();
    };
    const suggested = address?.street ?? '';
    if (Platform.OS === 'ios') {
      Alert.prompt(
        t('Save this place'),
        t('Your circle is told when people arrive or leave.'),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('Save'), onPress: (name?: string) => save(name ?? suggested) },
        ],
        'plain-text',
        suggested,
      );
    } else {
      save(suggested);
    }
  }

  return (
    <Animated.View style={[styles.card, { transform: [{ translateY }] }]} accessibilityViewIsModal>
      <View style={styles.grabber} />
      <View style={styles.head}>
        <View style={[styles.photoRing, stale && styles.photoRingStale]}>
          <Avatar id={member.id} name={member.full_name} url={member.avatar_url} size={58} />
        </View>
        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
              {isMe ? t('You') : member.full_name}
            </Text>
            <View style={[styles.liveDot, stale && styles.liveDotOff]} />
            <Text style={[styles.liveText, stale && styles.liveTextOff]} numberOfLines={1}>
              {stale ? t('Last seen {ago}', { ago: timeAgo(loc.recorded_at) }) : t('Live')}
            </Text>
          </View>
          {status && <Text style={styles.status} numberOfLines={1}>{status}</Text>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.whereBlock}>
        <Text style={styles.where} numberOfLines={1}>{where}</Text>
        <Text style={styles.area} numberOfLines={1}>
          {[place ? address?.street : null, address?.area].filter(Boolean).join(' · ') || ' '}
        </Text>
      </View>

      {watches.map((w) => (
        <View key={w.id} style={styles.watch}>
          <Text style={styles.watchText} numberOfLines={1}>
            🔔{' '}
            {w.kind === 'arrive'
              ? t("You'll be told when {name} gets to {place}", { name: firstName, place: w.label })
              : t("You'll be told when {name} leaves {place}", { name: firstName, place: w.label })}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => cancelWatch(w)} hitSlop={8}>
            <Text style={styles.watchCancel}>{t('Cancel')}</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.chips}>
        {since ? (
          <Chip icon="🕒" label={t('Here since {time}', { time: formatClockTime(since) })} sub={stayLength(since)} />
        ) : (
          <Chip icon="🕒" label={t('Updated {ago}', { ago: timeAgo(loc.recorded_at) })} sub={formatClockTime(loc.recorded_at)} />
        )}
        {battery != null && (
          <Chip
            icon={isLowBattery(loc.battery_level) ? '🪫' : '🔋'}
            label={`${battery}%`}
            sub={t('battery')}
            warn={isLowBattery(loc.battery_level)}
          />
        )}
        {badges.mph != null && <Chip icon="🚗" label={`${badges.mph} mph`} sub={t('driving')} />}
      </View>

      <View style={styles.actions}>
        {!isMe && (
          <Action
            icon="🧭"
            label={t('Directions')}
            primary
            onPress={() => Linking.openURL(externalMapsUrl({ latitude: loc.latitude, longitude: loc.longitude }, Platform.OS))}
          />
        )}
        {!isMe && (
          <Action
            icon="💬"
            label={t('Message')}
            onPress={() => {
              onClose();
              router.push('/chat');
            }}
          />
        )}
        {!isMe && member.phone_number && (
          <Action icon="📞" label={t('Call')} onPress={() => Linking.openURL(`tel:${member.phone_number}`)} />
        )}
        {!isMe && <Action icon="🔔" label={t('Notify me')} onPress={notifyMe} />}
        {!place && circleId && <Action icon="📌" label={t('Save place')} onPress={savePlace} />}
        <Action
          icon="👤"
          label={t('Details')}
          onPress={() => {
            onClose();
            router.push(`/member/${member.id}`);
          }}
        />
      </View>
    </Animated.View>
  );
}

function Chip({ icon, label, sub, warn }: { icon: string; label: string; sub: string; warn?: boolean }) {
  return (
    <View style={[styles.chip, warn && styles.chipWarn]}>
      <Text allowFontScaling={false} style={styles.chipIcon}>{icon}</Text>
      <View style={styles.chipText}>
        <Text style={[styles.chipLabel, warn && { color: colors.danger }]} numberOfLines={1}>{label}</Text>
        <Text style={styles.chipSub} numberOfLines={1}>{sub}</Text>
      </View>
    </View>
  );
}

function Action({ icon, label, onPress, primary }: { icon: string; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.actionCircle, primary && styles.actionCirclePrimary]}>
        <Text allowFontScaling={false} style={styles.actionIcon}>{icon}</Text>
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: 28,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: isDark ? 'rgba(20,22,30,0.98)' : 'rgba(255,255,255,0.98)',
    borderWidth: isDark ? 1 : 0,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photoRing: { padding: 3, borderRadius: radius.full, backgroundColor: colors.accentFill },
  photoRingStale: { backgroundColor: colors.offline },
  headText: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 24, fontWeight: '800', color: colors.textHeading, flexShrink: 1, letterSpacing: -0.3 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.online },
  liveDotOff: { backgroundColor: colors.offline },
  liveText: { fontSize: 12, fontWeight: '700', color: colors.online, flexShrink: 1 },
  liveTextOff: { color: colors.text, fontWeight: '600' },
  status: { fontSize: 14, color: colors.textHeading },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 15, fontWeight: '700', color: colors.text },
  whereBlock: { gap: 2 },
  where: { fontSize: 19, fontWeight: '800', color: colors.textHeading },
  area: { fontSize: 14, color: colors.text },
  watch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.tint,
  },
  watchText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textHeading },
  watchCancel: { fontSize: 13, fontWeight: '700', color: colors.accent },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    backgroundColor: colors.chip,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  chipWarn: { backgroundColor: isDark ? 'rgba(220,38,38,0.18)' : '#fef2f2' },
  chipIcon: { fontSize: 18 },
  chipText: { flexShrink: 1 },
  chipLabel: { fontSize: 13, fontWeight: '800', color: colors.textHeading },
  chipSub: { fontSize: 11.5, color: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: 6, minWidth: 60 },
  actionCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCirclePrimary: { backgroundColor: colors.accentFill },
  actionIcon: { fontSize: 21 },
  actionLabel: { fontSize: 12, fontWeight: '700', color: colors.textHeading },
}));
