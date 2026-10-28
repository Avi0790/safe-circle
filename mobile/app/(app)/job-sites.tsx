import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ErrorText } from '@/components/ErrorText';
import { useAccount } from '@/contexts/AccountContext';
import { MIN_QUERY_LENGTH, searchPlaces, type PlaceResult } from '@/lib/geocode';
import { MAX_REGIONS } from '@/lib/jobSiteReminders';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

interface Site {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
}

const RADII = [100, 150, 300, 500];

// The organization's job sites (migration ...000068): owners and admins add
// and remove them, managers can look. Workers who opt in get a reminder from
// their own phone when they arrive at one without clocking in; nobody at work
// is told (lib/jobSiteReminders.ts).
export default function JobSitesScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { orgs } = useAccount();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const org = orgs.find((o) => o.org_id === orgId);
  const canEdit = org?.role === 'owner' || org?.role === 'admin';

  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState('');
  const [radiusM, setRadiusM] = useState(150);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('org_job_sites', { p_org: orgId });
    if (rpcError) setError(rpcError.message);
    else setSites((data as Site[] | null) ?? []);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(latitude: number, longitude: number, fallbackName?: string) {
    const siteName = name.trim() || fallbackName?.trim() || '';
    if (!siteName) {
      setError('Give the job site a name.');
      return;
    }
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('add_job_site', {
      p_org: orgId,
      p_name: siteName,
      p_latitude: latitude,
      p_longitude: longitude,
      p_radius_m: radiusM,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setName('');
    setQuery('');
    setResults([]);
    await load();
  }

  async function addHere() {
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is off for Safe Circle.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      await add(pos.coords.latitude, pos.coords.longitude);
    } catch {
      setError('Could not get your current location.');
    }
  }

  async function search() {
    setError(null);
    const found = await searchPlaces(query);
    setResults(found);
    if (found.length === 0) setError('No places found.');
  }

  function remove(site: Site) {
    Alert.alert(`Remove ${site.name}?`, 'Workers stop getting reminders there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error: rpcError } = await supabase.rpc('delete_job_site', { p_site: site.id });
          if (rpcError) setError(rpcError.message);
          await load();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Job sites', headerBackTitle: 'Work' }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={typography.body}>
          Workers who turn on job site reminders get a nudge from their own phone when they arrive at
          one of these without clocking in. Their phone keeps that to itself: nobody here is told
          they were there.
        </Text>

        <Text style={styles.sectionLabel} accessibilityRole="header">
          Sites ({sites.length} of {MAX_REGIONS})
        </Text>
        {sites.length === 0 && <Text style={typography.caption}>No job sites yet.</Text>}
        {sites.map((s) => (
          <View key={s.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={typography.caption}>{s.radius_m} m radius</Text>
            </View>
            {canEdit && <Button title="Remove" variant="secondary" onPress={() => remove(s)} />}
          </View>
        ))}

        {canEdit && sites.length < MAX_REGIONS && (
          <View style={styles.add}>
            <Text style={styles.sectionLabel} accessibilityRole="header">Add a site</Text>
            <TextField label="Name" placeholder="Main St yard" value={name} onChangeText={setName} autoCapitalize="words" maxLength={80} />
            <Text style={typography.caption}>How close counts as arriving</Text>
            <View style={styles.chips}>
              {RADII.map((r) => (
                <Button key={r} title={`${r} m`} variant={radiusM === r ? 'primary' : 'secondary'} onPress={() => setRadiusM(r)} />
              ))}
            </View>
            <Button title="Add where I am now" onPress={addHere} loading={busy} />
            <TextField
              label="Or search an address"
              placeholder="1815 E Highland Dr, Jonesboro"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={search}
              returnKeyType="search"
            />
            <Button title="Search" variant="secondary" onPress={search} disabled={query.trim().length < MIN_QUERY_LENGTH} />
            {results.map((p) => (
              <Pressable accessibilityRole="button" key={p.id} style={styles.result} onPress={() => add(p.latitude, p.longitude, p.title)} accessibilityLabel={`Add ${p.title}`}>
                <Text style={styles.name}>{p.title}</Text>
                <Text style={typography.caption}>{p.subtitle}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {error && <ErrorText style={styles.error}>{error}</ErrorText>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  name: typography.heading,
  add: { gap: spacing.sm, marginTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  result: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { color: colors.danger, fontSize: 14 },
}));
