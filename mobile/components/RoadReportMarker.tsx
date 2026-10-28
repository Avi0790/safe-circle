import { Alert, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { clearReport, reportDetails, reportInfo, type RoadReport } from '@/lib/roadReports';
import { colors, radius, themed } from '@/lib/theme';

// A crash, hazard, speed check or closed road someone in the circle reported
// while driving (lib/roadReports.ts). Tapping says who and when; your own
// report can be taken back from here, like a pin you dropped.
export function RoadReportMarker({
  report,
  myUserId,
  onChanged,
}: {
  report: RoadReport;
  myUserId: string | undefined;
  onChanged: () => void;
}) {
  const info = reportInfo(report.kind);

  function handlePress() {
    const { title, body } = reportDetails(report, myUserId);
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'OK', style: 'cancel' },
    ];
    if (report.reporter_id === myUserId) {
      buttons.push({
        text: 'Take back report',
        style: 'destructive',
        onPress: async () => {
          await clearReport(report.id);
          onChanged();
        },
      });
    }
    Alert.alert(title, body, buttons);
  }

  return (
    <Marker
      coordinate={{ latitude: report.latitude, longitude: report.longitude }}
      title={`${info.label} reported`}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={handlePress}
    >
      <View style={styles.ring} accessibilityLabel={`${info.label} reported`}>
        <Text style={styles.emoji}>{info.emoji}</Text>
      </View>
    </Marker>
  );
}

const styles = themed(() => StyleSheet.create({
  ring: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: colors.danger,
  },
  emoji: { fontSize: 16 },
}));
