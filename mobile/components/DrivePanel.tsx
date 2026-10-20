import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatNavDistance } from '@/lib/navigation';
import { ROAD_REPORT_KINDS, type RoadReportKind } from '@/lib/roadReports';
import { STOP_CATEGORIES, type StopCategory, type StopResult } from '@/lib/stops';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { VOICE_MODES, type VoiceMode } from '@/lib/voicePreference';

// The card that slides up over navigation, like Apple Maps': audio, Share
// ETA, report an incident, add a stop, end the route. Everything is one or two
// big taps: nothing here asks for typing while driving.
export interface DrivePanelProps {
  view: 'main' | 'stops';
  bottomInset: number;
  voiceMode: VoiceMode;
  onVoiceMode: (mode: VoiceMode) => void;
  // null when there's no circle to share with
  circleName: string | null;
  sharing: boolean;
  onToggleShare: () => void;
  onReport: (kind: RoadReportKind) => void;
  reporting: boolean;
  stopTitle: string | null;
  onAddStop: () => void;
  onRemoveStop: () => void;
  stopCategory: StopCategory | null;
  stopResults: StopResult[];
  stopSearching: boolean;
  stopError: string | null;
  onPickCategory: (c: StopCategory) => void;
  onPickStop: (s: StopResult) => void;
  onBack: () => void;
  onClose: () => void;
  onEnd: () => void;
}

export function DrivePanel(p: DrivePanelProps) {
  return (
    <View style={[styles.sheet, { paddingBottom: p.bottomInset + spacing.md }]}>
      <View style={styles.header}>
        <Text style={typography.heading}>{p.view === 'stops' ? 'Add a stop' : 'Options'}</Text>
        <Pressable onPress={p.view === 'stops' ? p.onBack : p.onClose} hitSlop={10} accessibilityRole="button">
          <Text style={styles.close}>{p.view === 'stops' ? 'Back' : 'Done'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {p.view === 'stops' ? (
          <>
            <View style={styles.grid}>
              {STOP_CATEGORIES.map((c) => (
                <Pressable
                  key={c.key}
                  style={[styles.tile, p.stopCategory === c.key && styles.tileOn]}
                  onPress={() => p.onPickCategory(c.key)}
                  accessibilityState={{ selected: p.stopCategory === c.key }}
                >
                  <Text style={styles.tileEmoji}>{c.emoji}</Text>
                  <Text style={[styles.tileText, p.stopCategory === c.key && styles.tileTextOn]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
            {p.stopSearching && (
              <View style={styles.inline}>
                <ActivityIndicator />
                <Text style={typography.caption}>Looking along your route…</Text>
              </View>
            )}
            {p.stopError && <Text style={styles.error}>{p.stopError}</Text>}
            {p.stopCategory && !p.stopSearching && p.stopResults.length === 0 && !p.stopError && (
              <Text style={typography.caption}>Nothing found near the road ahead.</Text>
            )}
            {p.stopResults.map((s) => (
              <Pressable key={s.id} style={styles.row} onPress={() => p.onPickStop(s)}>
                <Text style={styles.rowTitle}>{s.title}</Text>
                <Text style={typography.caption}>
                  {formatNavDistance(s.aheadM)} ahead · {s.offRouteM < 50 ? 'on your route' : `${formatNavDistance(s.offRouteM)} off route`}
                </Text>
              </Pressable>
            ))}
            <Text style={styles.footnote}>Places come from OpenStreetMap and may be closed or missing.</Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>Audio</Text>
            <View style={styles.segment} accessibilityRole="tablist">
              {VOICE_MODES.map(({ mode, label }) => (
                <Pressable
                  key={mode}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: p.voiceMode === mode }}
                  style={[styles.segBtn, p.voiceMode === mode && styles.tileOn]}
                  onPress={() => p.onVoiceMode(mode)}
                >
                  <Text style={[styles.segText, p.voiceMode === mode && styles.tileTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={typography.caption}>
              {p.voiceMode === 'alerts'
                ? 'Only incidents reported ahead and your arrival are spoken.'
                : p.voiceMode === 'off'
                  ? 'Nothing is spoken. Directions stay on screen.'
                  : 'Turn-by-turn directions and alerts are spoken.'}
            </Text>

            {p.circleName && (
              <Pressable style={[styles.action, p.sharing && styles.actionOn]} onPress={p.onToggleShare}>
                <Text style={styles.actionText}>{p.sharing ? `👪 Stop sharing ETA with ${p.circleName}` : `👪 Share ETA with ${p.circleName}`}</Text>
              </Pressable>
            )}

            <Text style={styles.label}>Report an incident</Text>
            <View style={styles.grid}>
              {ROAD_REPORT_KINDS.map((k) => (
                <Pressable
                  key={k.kind}
                  style={styles.tile}
                  disabled={p.reporting}
                  onPress={() => p.onReport(k.kind)}
                  accessibilityLabel={`Report ${k.label}`}
                >
                  <Text style={styles.tileEmoji}>{k.emoji}</Text>
                  <Text style={styles.tileText}>{k.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={typography.caption}>
              Reported where you are now. Your circle sees it for an hour (3 for a closed road).
            </Text>

            {p.stopTitle ? (
              <Pressable style={styles.action} onPress={p.onRemoveStop}>
                <Text style={styles.actionText}>✕ Remove stop: {p.stopTitle}</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.action} onPress={p.onAddStop}>
                <Text style={styles.actionText}>➕ Add a stop</Text>
              </Pressable>
            )}

            <Pressable style={[styles.action, styles.endAction]} onPress={p.onEnd}>
              <Text style={styles.endText}>End route</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '75%',
    backgroundColor: colors.bg,
    paddingTop: spacing.md,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  close: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  body: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
  label: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  segText: { fontSize: 14, fontWeight: '600', color: colors.textHeading },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '30%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 2,
  },
  tileOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tileEmoji: { fontSize: 26 },
  tileText: { fontSize: 14, fontWeight: '600', color: colors.textHeading },
  tileTextOn: { color: '#fff' },
  action: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    marginTop: spacing.sm,
  },
  actionOn: { borderColor: colors.accent },
  actionText: { fontSize: 16, fontWeight: '600', color: colors.textHeading },
  endAction: { backgroundColor: colors.danger, borderColor: colors.danger, alignItems: 'center' },
  endText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
    backgroundColor: colors.bgElevated,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.textHeading },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  error: { color: colors.danger, fontSize: 14 },
  footnote: { ...typography.caption, marginTop: spacing.xs },
});
