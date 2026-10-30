import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { ErrorText } from '@/components/ErrorText';
import { Card, Chip, ui } from '@/components/ui/AppUI';
import { timeAgo } from '@/lib/format';
import { t } from '@/lib/i18n';
import { incidentKindInfo, incidentPhotoUrl } from '@/lib/incidents';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

interface Row {
  id: string;
  reporter_name: string | null;
  kind: string;
  note: string;
  latitude: number | null;
  longitude: number | null;
  photo_path: string | null;
  status: 'open' | 'resolved';
  created_at: string;
  can_resolve: boolean;
}

type Filter = 'open' | 'resolved';

// Incident and hazard reports for the people who oversee the reporters
// (org_incidents, migration ...000072): owners and admins see all, a manager
// sees their teams'. Each can be marked resolved.
export default function IncidentsScreen() {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const { orgId, orgName } = useLocalSearchParams<{ orgId: string; orgName?: string }>();
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('org_incidents', { p_org: orgId, p_status: filter });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const list = (data as Row[] | null) ?? [];
    setRows(list);
    const urls: Record<string, string> = {};
    await Promise.all(
      list
        .filter((r) => r.photo_path)
        .map(async (r) => {
          const url = await incidentPhotoUrl(r.photo_path!);
          if (url) urls[r.id] = url;
        }),
    );
    setPhotos(urls);
  }, [orgId, filter]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  async function resolve(id: string) {
    setError(null);
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc('resolve_incident', { p_id: id });
    setBusyId(null);
    if (rpcError) setError(rpcError.message);
    await load();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: t('Incidents'), headerBackTitle: t('Work') }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      >
        {orgName ? <Text style={typography.caption}>{orgName}</Text> : null}
        <View style={ui.chips}>
          <Chip label={t('Open')} selected={filter === 'open'} onPress={() => setFilter('open')} />
          <Chip label={t('Resolved')} selected={filter === 'resolved'} onPress={() => setFilter('resolved')} />
        </View>
        {error && <ErrorText style={styles.error}>{t(error)}</ErrorText>}
        {rows === null ? (
          <ActivityIndicator />
        ) : rows.length === 0 ? (
          <Text style={typography.body}>{filter === 'open' ? t('No open reports.') : t('No resolved reports yet.')}</Text>
        ) : (
          rows.map((r) => {
            const info = incidentKindInfo(r.kind);
            return (
              <Card key={r.id} tone={r.status === 'open' && r.kind === 'injury' ? 'danger' : r.status === 'open' ? 'warn' : undefined}>
                <Text style={ui.rowTitle} accessibilityRole="header">
                  {info.emoji} {t(info.label)}
                </Text>
                <Text style={ui.rowSub}>
                  {t('{name} · {ago}', { name: r.reporter_name ?? t('Someone'), ago: timeAgo(r.created_at) })}
                </Text>
                <Text style={typography.body}>{r.note}</Text>
                {photos[r.id] && (
                  <Image source={{ uri: photos[r.id] }} style={styles.photo} accessibilityLabel={t('Photo from the report')} />
                )}
                {r.latitude != null && r.longitude != null && (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() =>
                      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`).catch(() => {})
                    }
                  >
                    <Text style={styles.link}>{t('View on map ›')}</Text>
                  </Pressable>
                )}
                {r.status === 'open' && r.can_resolve && (
                  <Button title={t('Mark resolved')} variant="secondary" onPress={() => resolve(r.id)} loading={busyId === r.id} />
                )}
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.chip },
  link: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
}));
