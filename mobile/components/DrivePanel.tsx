import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatNavDistance } from '@/lib/navigation';
import { ROAD_REPORT_KINDS, type RoadReportKind } from '@/lib/roadReports';
import { STOP_CATEGORIES, type StopCategory, type StopResult } from '@/lib/stops';
import { colors, radius, spacing, themed, typography } from '@/lib/theme';
import { VOICE_MODES, type VoiceMode } from '@/lib/voicePreference';
import { vehicleColorName, vehicleStyleName, type VehiclePreference } from '@/lib/vehiclePreference';
import { AvatarArt } from '@/components/AvatarArt';
import { ErrorText } from '@/components/ErrorText';
import { t } from '@/lib/i18n';

// The card that slides up over navigation, like Apple Maps': audio, Share
// ETA, report an incident, add a stop, end the route. Everything is one or two
// big taps: nothing here asks for typing while driving.
export interface DrivePanelProps {
  // 'report' is the Report pill's shortcut straight to the incident buttons
  view: 'main' | 'stops' | 'report';
  vehicle?: VehiclePreference;
  // opens the Choose driving avatar sheet
  onOpenAvatar?: () => void;
  // opens Map Modes (Explore, Driving, Satellite, 3D Flyover)
  onOpenMapModes?: () => void;
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
                  accessibilityRole="button"
                  key={c.key}
                  style={[styles.tile, p.stopCategory === c.key && styles.tileOn]}
                  onPress={() => p.onPickCategory(c.key)}
                  accessibilityState={{ selected: p.stopCategory === c.key }}
                >
                  <Text allowFontScaling={false} style={styles.tileEmoji}>{c.emoji}</Text>
                  <Text style={[styles.tileText, p.stopCategory === c.key && styles.tileTextOn]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
            {p.stopSearching && (
              <View style={styles.inline}>
                <ActivityIndicator />
                <Text style={typography.caption}>{t('Looking along your route…')}</Text>
              </View>
            )}
            {p.stopError && <ErrorText style={styles.error}>{p.stopError}</ErrorText>}
            {p.stopCategory && !p.stopSearching && p.stopResults.length === 0 && !p.stopError && (
              <Text style={typography.caption}>{t('Nothing found near the road ahead.')}</Text>
            )}
            {p.stopResults.map((s) => (
              <Pressable accessibilityRole="button" key={s.id} style={styles.row} onPress={() => p.onPickStop(s)}>
                <Text style={styles.rowTitle}>{s.title}</Text>
                <Text style={typography.caption}>
                  {formatNavDistance(s.aheadM)} ahead · {s.offRouteM < 50 ? 'on your route' : `${formatNavDistance(s.offRouteM)} off route`}
                </Text>
              </Pressable>
            ))}
            <Text style={styles.footnote}>{t('Places come from OpenStreetMap and may be closed or missing.')}</Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>{t('Audio')}</Text>
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
              <Pressable accessibilityRole="button" style={[styles.action, p.sharing && styles.actionOn]} onPress={p.onToggleShare}>
                <Text style={styles.actionText}>{p.sharing ? `👪 Stop sharing ETA with ${p.circleName}` : `👪 Share ETA with ${p.circleName}`}</Text>
              </Pressable>
            )}

            {p.linkShared ? (
              <Pressable accessibilityRole="button" style={[styles.action, styles.actionOn]} onPress={p.onStopLink}>
                <Text style={styles.actionText}>{t('🔗 Stop the live ETA link')}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" style={styles.action} onPress={p.onShareAnyone}>
                <Text style={styles.actionText}>{t('📤 Share ETA with anyone…')}</Text>
              </Pressable>
            )}

            <Text style={styles.label}>{t('Report an incident')}</Text>
            <ReportGrid {...p} />

            {p.vehicle && p.onOpenAvatar && (
              <Pressable style={styles.avatarRow} onPress={p.onOpenAvatar} accessibilityRole="button" accessibilityLabel={t('Choose driving avatar')}>
                <AvatarArt style={p.vehicle.style} color={p.vehicle.color} width={92} />
                <View style={styles.avatarText}>
                  <Text style={styles.actionText}>{t('Driving avatar')}</Text>
                  <Text style={typography.caption}>
                    {vehicleStyleName(p.vehicle.style)} · {vehicleColorName(p.vehicle.color)}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}

            {p.onOpenMapModes && (
              <Pressable style={styles.action} onPress={p.onOpenMapModes} accessibilityRole="button" accessibilityLabel={t('Map mode')}>
                <Text style={styles.actionText}>{t('🗺️ Map mode ›')}</Text>
              </Pressable>
            )}

            {p.stopTitle ? (
              <Pressable accessibilityRole="button" style={styles.action} onPress={p.onRemoveStop}>
                <Text style={styles.actionText}>✕ Remove stop: {p.stopTitle}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" style={styles.action} onPress={p.onAddStop}>
                <Text style={styles.actionText}>{t('➕ Add a stop')}</Text>
              </Pressable>
            )}

            <Pressable accessibilityRole="button" style={[styles.action, styles.endAction]} onPress={p.onEnd}>
              <Text style={styles.endText}>{t('End route')}</Text>
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
            accessibilityRole="button"
            key={k.kind}
            style={styles.tile}
            disabled={p.reporting}
            onPress={() => p.onReport(k.kind)}
            accessibilityLabel={`Report ${k.label}`}
          >
            <Text allowFontScaling={false} style={styles.tileEmoji}>{k.emoji}</Text>
            <Text style={styles.tileText}>{k.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={typography.caption}>
        {t('Reported where you are now. Your circle sees it for an hour (3 for a closed road).')}
      </Text>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
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
  tileOn: { backgroundColor: colors.accentFill, borderColor: colors.accent },
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
  endAction: { backgroundColor: colors.dangerFill, borderColor: colors.dangerFill, alignItems: 'center' },
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
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    marginTop: spacing.sm,
  },
  avatarText: { flex: 1, gap: 2 },
  chevron: { fontSize: 26, color: colors.offline },
}));
