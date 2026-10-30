import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Button } from '@/components/Button';
import { ErrorText } from '@/components/ErrorText';
import { TextField } from '@/components/TextField';
import { Card, Chip, SectionTitle, ui } from '@/components/ui/AppUI';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { announce } from '@/lib/announce';
import { timeAgo } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  INCIDENT_KINDS,
  incidentKindInfo,
  NOTE_MAX,
  pickIncidentPhoto,
  submitIncident,
  type IncidentKind,
} from '@/lib/incidents';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

interface MyReport {
  id: string;
  kind: string;
  note: string;
  status: string;
  created_at: string;
}

// Report a hazard, a near miss or an injury at work (lib/incidents.ts). The
// people who oversee you are told at once; your position goes with it only
// while you're clocked in there.
export default function ReportIncidentScreen() {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const router = useRouter();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { session } = useAuth();
  const { orgs } = useAccount();
  const org = orgs.find((o) => o.org_id === orgId);
  const onShift = !!org?.on_shift;

  const [kind, setKind] = useState<IncidentKind>('hazard');
  const [note, setNote] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [withLocation, setWithLocation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MyReport[]>([]);

  const load = useCallback(async () => {
    if (!session || !orgId) return;
    const { data } = await supabase
      .from('incident_reports')
      .select('id, kind, note, status, created_at')
      .eq('org_id', orgId)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(10);
    setMine((data as MyReport[] | null) ?? []);
  }, [session, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addPhoto(source: 'camera' | 'library') {
    setError(null);
    const result = await pickIncidentPhoto(source);
    if (result.ok) setPhotoUri(result.uri);
    else if (!result.cancelled) setError(t(result.error));
  }

  async function send() {
    if (!session || !orgId) return;
    setError(null);
    setBusy(true);
    let position: { latitude: number; longitude: number } | null = null;
    if (onShift && withLocation) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          position = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        }
      } catch {
        // sent without a position rather than not at all
      }
    }
    const result = await submitIncident({ orgId, userId: session.user.id, kind, note, photoUri, position });
    setBusy(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    announce(t('Report sent'));
    setNote('');
    setPhotoUri(null);
    await load();
    Alert.alert(t('Report sent'), t('The people who oversee you have been told.'), [
      { text: t('Done'), onPress: () => router.back() },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: t('Report an incident'), headerBackTitle: t('Work') }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.body}>
          {t('Tell the people who oversee you about a hazard, a near miss or an injury. They get it right away.')}
        </Text>

        <View style={styles.section}>
          <SectionTitle>{t('What happened')}</SectionTitle>
          <View style={ui.chips}>
            {INCIDENT_KINDS.map((k) => (
              <Chip
                key={k.kind}
                label={`${k.emoji} ${t(k.label)}`}
                accessibilityLabel={t(k.label)}
                selected={kind === k.kind}
                onPress={() => setKind(k.kind)}
              />
            ))}
          </View>
        </View>

        <TextField
          label={t('Details')}
          placeholder={t('What, where, and is anyone hurt?')}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={NOTE_MAX}
          autoCapitalize="sentences"
          autoCorrect
          style={styles.note}
        />

        <View style={styles.section}>
          <SectionTitle>{t('Photo (optional)')}</SectionTitle>
          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photoUri }} style={styles.photo} accessibilityLabel={t('The photo to send')} />
              <Pressable accessibilityRole="button" onPress={() => setPhotoUri(null)} hitSlop={8}>
                <Text style={styles.removeText}>{t('Remove photo')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button title={t('Take photo')} variant="secondary" onPress={() => addPhoto('camera')} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t('Choose photo')} variant="secondary" onPress={() => addPhoto('library')} />
              </View>
            </View>
          )}
        </View>

        {onShift ? (
          <View style={[styles.row, styles.locationRow]}>
            <Text style={[typography.body, { flex: 1 }]}>{t('Include where I am')}</Text>
            <Switch
              accessibilityLabel={t('Include where I am')}
              value={withLocation}
              onValueChange={setWithLocation}
              trackColor={{ true: colors.accent }}
            />
          </View>
        ) : (
          <Text style={typography.caption}>{t("You're off shift, so your location isn't included.")}</Text>
        )}

        {error && <ErrorText style={styles.error}>{error}</ErrorText>}
        <Button title={t('Send report')} onPress={send} loading={busy} disabled={!note.trim()} />

        {mine.length > 0 && (
          <Card>
            <SectionTitle>{t('Your reports')}</SectionTitle>
            {mine.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <View style={ui.divider} />}
                <Text style={ui.rowTitle}>
                  {incidentKindInfo(r.kind).emoji} {t(incidentKindInfo(r.kind).label)} ·{' '}
                  {r.status === 'resolved' ? t('Resolved') : t('Open')}
                </Text>
                <Text style={ui.rowSub} numberOfLines={2}>
                  {r.note} · {timeAgo(r.created_at)}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  section: { gap: spacing.sm },
  note: { minHeight: 110, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  locationRow: { justifyContent: 'space-between' },
  photoWrap: { gap: spacing.sm, alignItems: 'flex-start' },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.chip },
  removeText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
}));
