import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/Avatar';
import { externalMapsUrl } from '@/lib/externalMaps';
import { formatClockTime, getShareStatus, isLowBattery, isStale, isStatusActive, timeAgo } from '@/lib/format';
import { t } from '@/lib/i18n';
import { pinBadges } from '@/components/MemberPin';
import { colors, isDark, radius, spacing, themed, useThemeVersion } from '@/lib/theme';
import type { MemberWithLocation } from '@/lib/types';

// Tap someone's pin on the Map tab: this card slides up with who they are,
// where they are (a street address), how fresh that is, their battery and
// whether they're driving, and what you can do: directions there, a message,
// a call, or their full details.

// "1815 E Highland Dr, Jonesboro" from the phone's own geocoder (Apple or
// Google), cached per spot so reopening a card doesn't look it up again.
const addressCache = new Map<string, string | null>();
const spotKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

export function formatAddress(a: Partial<Location.LocationGeocodedAddress> | undefined): string | null {
  if (!a) return null;
  const street = [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name || null;
  const place = a.city ?? a.subregion ?? a.region ?? null;
  const parts = [street, place].filter((p, i, all) => p && all.indexOf(p) === i);
  return parts.length > 0 ? parts.join(', ') : null;
}

function useAddress(lat: number, lng: number): string | null {
  const key = spotKey(lat, lng);
  const [address, setAddress] = useState<string | null>(addressCache.get(key) ?? null);
  useEffect(() => {
    if (addressCache.has(key)) {
      setAddress(addressCache.get(key) ?? null);
      return;
    }
    let alive = true;
    setAddress(null);
    Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
      .then((results) => {
        const text = formatAddress(results[0]);
        addressCache.set(key, text);
        if (alive) setAddress(text);
      })
      .catch(() => {
        // no address is fine: the card still shows everything else
      });
    return () => {
      alive = false;
    };
  }, [key, lat, lng]);
  return address;
}

export function MemberCard({
  member,
  isMe,
  onClose,
  bottomInset = 0,
}: {
  member: MemberWithLocation;
  isMe: boolean;
  onClose: () => void;
  bottomInset?: number;
}) {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const router = useRouter();
  const loc = member.location!;
  const address = useAddress(loc.latitude, loc.longitude);
  const badges = pinBadges(member);
  const stale = isStale(loc.recorded_at);
  const battery = loc.battery_level != null ? Math.round(loc.battery_level * 100) : null;
  const status = [
    member.status_emoji && isStatusActive(member.status_expires_at) ? `${member.status_emoji} ${member.status_text ? t(member.status_text) : ''}`.trim() : null,
    getShareStatus(member.share_until) === 'window' && member.share_until
      ? t('sharing until {time}', { time: formatClockTime(member.share_until) })
      : null,
  ].filter(Boolean).join(' · ') || null;

  // slide up when opened, or when another person is picked
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rise.setValue(0);
    Animated.spring(rise, { toValue: 1, useNativeDriver: true, bounciness: 6 }).start();
  }, [member.id, rise]);
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [240, 0] });

  const freshness = stale
    ? t('Last seen {ago}', { ago: timeAgo(loc.recorded_at) })
    : t('Updated {ago}', { ago: timeAgo(loc.recorded_at) });

  return (
    <Animated.View
      style={[styles.card, { bottom: bottomInset + spacing.md, transform: [{ translateY }] }]}
      accessibilityViewIsModal
    >
      <View style={styles.head}>
        <View style={[styles.photoRing, stale && styles.photoRingStale]}>
          <Avatar id={member.id} name={member.full_name} url={member.avatar_url} size={56} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
            {isMe ? t('You') : member.full_name}
          </Text>
          {status && <Text style={styles.status} numberOfLines={1}>{status}</Text>}
          <Text style={styles.address} numberOfLines={2}>
            {address ?? t('Finding the address…')}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.facts}>
        <Fact label={freshness} sub={formatClockTime(loc.recorded_at)} warn={stale} />
        {battery != null && <Fact label={`${isLowBattery(loc.battery_level) ? '🪫' : '🔋'} ${battery}%`} sub={t('battery')} warn={isLowBattery(loc.battery_level)} />}
        {badges.mph != null && <Fact label={`🚗 ${badges.mph} mph`} sub={t('driving')} />}
      </View>

      <View style={styles.actions}>
        {!isMe && (
          <Action
            icon="🧭"
            label={t('Directions')}
            onPress={() => Linking.openURL(externalMapsUrl({ latitude: loc.latitude, longitude: loc.longitude }, Platform.OS))}
          />
        )}
        {!isMe && <Action icon="💬" label={t('Message')} onPress={() => { onClose(); router.push('/chat'); }} />}
        {!isMe && member.phone_number && (
          <Action icon="📞" label={t('Call')} onPress={() => Linking.openURL(`tel:${member.phone_number}`)} />
        )}
        <Action icon="ℹ️" label={t('Details')} onPress={() => { onClose(); router.push(`/member/${member.id}`); }} />
      </View>
    </Animated.View>
  );
}

function Fact({ label, sub, warn }: { label: string; sub: string; warn?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, warn && { color: colors.danger }]} numberOfLines={1}>{label}</Text>
      <Text style={styles.factSub} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
      <Text allowFontScaling={false} style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    borderRadius: 24,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: isDark ? 'rgba(23,26,33,0.98)' : 'rgba(255,255,255,0.98)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photoRing: { padding: 3, borderRadius: radius.full, backgroundColor: colors.accentFill },
  photoRingStale: { backgroundColor: colors.offline },
  headText: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: '800', color: colors.textHeading },
  status: { fontSize: 14, color: colors.textHeading },
  address: { fontSize: 14, color: colors.text, lineHeight: 19 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 15, fontWeight: '700', color: colors.text },
  facts: { flexDirection: 'row', gap: spacing.sm },
  fact: { flex: 1, borderRadius: radius.md, backgroundColor: colors.chip, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, gap: 2 },
  factLabel: { fontSize: 14, fontWeight: '700', color: colors.textHeading },
  factSub: { fontSize: 12, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.tint },
  actionIcon: { fontSize: 20 },
  actionLabel: { fontSize: 12, fontWeight: '700', color: colors.accent },
}));
