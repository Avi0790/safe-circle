import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatNavDistance } from '@/lib/navigation';
import { ROAD_REPORT_KINDS, type RoadReportKind } from '@/lib/roadReports';
import { STOP_CATEGORIES, type StopCategory, type StopResult } from '@/lib/stops';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { VOICE_MODES, type VoiceMode } from '@/lib/voicePreference';
import { VEHICLE_COLORS, VEHICLE_STYLES, type VehiclePreference } from '@/lib/vehiclePreference';
import { VehicleIcon } from '@/components/VehicleIcon';

// The card that slides up over navigation, like Apple Maps': audio, Share
// ETA, report an incident, add a stop, end the route. Everything is one or two
// big taps: nothing here asks for typing while driving.
export interface DrivePanelProps {
  // 'report' is the Report pill's shortcut straight to the incident buttons
  view: 'main' | 'stops' | 'report';
  vehicle?: VehiclePreference;
  onVehicle?: (v: VehiclePreference) => void;
  bottomInset: number;
  voiceMode: VoiceMode;
  onVoiceMode: (mode: VoiceMode) => void;
  // null when there's no circle to share with
  circleName: string | null;
  sharing: boolean;
  onToggleShare: () => void;
  // Share ETA with anyone (a message, or a live link) outside the app.
  onShareAnyone: () => void;
  linkShared: boolean;
  onStopLink: () => void;
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
        <Text style={typography.heading}>{p.view === 'stops' ? 'Add a stop' : p.view === 'report' ? 'Report' : 'Options'}</Text>
        <Pressable onPress={p.view === 'stops' ? p.onBack : p.onClose} hitSlop={10} accessibilityRole="button">
          <Text style={styles.close}>{p.view === 'stops' ? 'Back' : 'Done'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {p.view === 'report' ? (
          <ReportGrid {...p} />
        ) : p.view === 'stops' ? (
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

            {p.linkShared ? (
              <Pressable style={[styles.action, styles.actionOn]} onPress={p.onStopLink}>
                <Text style={styles.actionText}>🔗 Stop the live ETA link</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.action} onPress={p.onShareAnyone}>
                <Text style={styles.actionText}>📤 Share ETA with anyone…</Text>
              </Pressable>
            )}

            <Text style={styles.label}>Report an incident</Text>
            <ReportGrid {...p} />

            {p.vehicle && p.onVehicle && (
              <>
                <Text style={styles.label}>Your vehicle</Text>
                <View style={styles.vehicleRow}>
                  {VEHICLE_STYLES.map(({ style, label }) => (
                    <Pressable
                      key={style}
                      style={[styles.vehicleTile, p.vehicle!.style === style && styles.vehicleTileOn]}
                      onPress={() => p.onVehicle!({ ...p.vehicle!, style })}
                      accessibilityLabel={`Vehicle: ${label}`}
                      accessibilityState={{ selected: p.vehicle!.style === style }}
                    >
                      <View style={styles.vehiclePreview}>
                        <VehicleIcon style={style} color={p.vehicle!.color} />
                      </View>
                      <Text style={styles.vehicleLabel}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.swatchRow}>
                  {VEHICLE_COLORS.map(({ color, hex, label }) => (
                    <Pressable
                      key={color}
                      style={[styles.swatch, { backgroundColor: hex }, p.vehicle!.color === color && styles.swatchOn]}
                      onPress={() => p.onVehicle!({ ...p.vehicle!, color })}
                      accessibilityLabel={`Colour: ${label}`}
                      accessibilityState={{ selected: p.vehicle!.color === color }}
                    />
                  ))}
                </View>
              </>
            )}

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

// The four incident buttons and what reporting means; in the Options card and
// on their own behind the Report pill.
function ReportGrid(p: DrivePanelProps) {
  return (
    <>
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
    </>
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
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  vehicleTile: {
    width: '23%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 4,
  },
  vehicleTileOn: { borderColor: colors.accent, borderWidth: 2 },
  vehiclePreview: { height: 96, justifyContent: 'center' },
  vehicleLabel: { fontSize: 13, fontWeight: '600', color: colors.textHeading },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingVertical: spacing.xs },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.border },
  swatchOn: { borderColor: colors.accent, borderWidth: 4 },
});
