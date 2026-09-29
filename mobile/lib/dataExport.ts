import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ExportResult = { ok: true } | { ok: false; error: string };

// Writes the export to a real .json file, then hands it to the native share
// sheet — not React Native's plain Share.share({ message }), which only
// ever offers to send the text somewhere (Mail, Messages, copy). iOS's
// share sheet only shows "Save to Files" for an actual document, so a
// plain-text share can never be saved as a file to open again later. A
// real file on disk gets that option, on both iOS and Android.
export async function exportDataToFile(data: unknown): Promise<ExportResult> {
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, error: 'Sharing is not available on this device.' };
    }

    // Dated filename so saving more than one export doesn't silently
    // overwrite the last one.
    const date = new Date().toISOString().slice(0, 10);
    const fileUri = `${FileSystem.cacheDirectory}safecircle-data-${date}.json`;
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(data, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });

    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Save your Safe Circle data',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not export your data.' };
  }
}
