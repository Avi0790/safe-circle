import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ShareFileResult = { ok: true } | { ok: false; error: string };

// Shared by dataExport.ts and locationReport.ts: writes a string to a real
// file in the cache dir, then hands it to the native share sheet. A real
// file on disk (not Share.share({ message })) is what gets iOS/Android's
// "Save to Files" option, so it can be reopened later instead of just sent
// as a one-off message.
export async function shareTextFile(
  filename: string,
  content: string,
  mimeType: string,
  dialogTitle: string,
): Promise<ShareFileResult> {
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, error: 'Sharing is not available on this device.' };
    }
    const fileUri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(fileUri, content, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    await Sharing.shareAsync(fileUri, { mimeType, dialogTitle });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create the file.' };
  }
}
