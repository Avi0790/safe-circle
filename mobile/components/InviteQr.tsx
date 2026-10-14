import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { buildJoinPayload } from '@/lib/joinCode';
import { qrMatrix } from '@/lib/qr';

// Plain black on white regardless of theme: scanners need the contrast, and
// a dark-mode inversion is the most common reason a QR "won't scan".
const QUIET_ZONE_MODULES = 2;

export function InviteQr({ code, size = 200 }: { code: string; size?: number }) {
  const matrix = useMemo(() => qrMatrix(buildJoinPayload(code)), [code]);
  const modules = matrix.length + QUIET_ZONE_MODULES * 2;
  const cell = Math.floor(size / modules);
  const side = cell * modules;

  return (
    <View
      accessible
      accessibilityLabel={`QR code for invite code ${code}`}
      style={[styles.frame, { width: side, height: side, padding: cell * QUIET_ZONE_MODULES }]}
    >
      {matrix.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((dark, c) => (
            <View
              key={c}
              style={{ width: cell, height: cell, backgroundColor: dark ? '#000000' : '#ffffff' }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#ffffff', alignSelf: 'center', borderRadius: 8 },
  row: { flexDirection: 'row' },
});
