import { useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { parseJoinCode } from '@/lib/joinCode';
import { colors, spacing, themed, typography } from '@/lib/theme';
import { t } from '@/lib/i18n';

// Scans a circle invite QR code and hands back the code. It only ever returns
// something that parses as a real invite code; any other QR code shows a
// message and keeps scanning, so a stray code on a wall can't do anything.
export function QrScannerModal({
  visible,
  onClose,
  onCode,
}: {
  visible: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  // onBarcodeScanned fires many times a second while a code is in view.
  const handled = useRef(false);

  function handleScanned({ data }: { data: string }) {
    if (handled.current) return;
    const code = parseJoinCode(data);
    if (code) {
      handled.current = true;
      setMessage(null);
      onCode(code);
      return;
    }
    handled.current = true;
    setMessage("That isn't a Safe Circle invite code.");
    setTimeout(() => {
      handled.current = false;
    }, 1500);
  }

  function close() {
    handled.current = false;
    setMessage(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={typography.heading}>{t('Scan an invite QR code')}</Text>
          <Button title={t('Cancel')} variant="secondary" onPress={close} />
        </View>

        {!permission ? null : !permission.granted ? (
          <View style={styles.center}>
            <Text style={typography.body}>
              {t('Safe Circle needs the camera to scan the QR code. Nothing is recorded or saved.')}
            </Text>
            <Button title={t('Allow camera')} onPress={requestPermission} />
          </View>
        ) : (
          <View style={styles.camera}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleScanned}
            />
            {message && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{message}</Text>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, gap: spacing.md },
  center: { padding: spacing.lg, gap: spacing.md },
  camera: { flex: 1, margin: spacing.lg, overflow: 'hidden', borderRadius: 12, backgroundColor: '#000' },
  banner: { position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg, backgroundColor: colors.dangerFill, padding: spacing.md, borderRadius: 8 },
  bannerText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
}));
