import { shareTextFile, type ShareFileResult } from '@/lib/shareFile';

export type ExportResult = ShareFileResult;

// Writes the export to a real .json file, then hands it to the native share
// sheet — not React Native's plain Share.share({ message }), which only
// ever offers to send the text somewhere (Mail, Messages, copy). iOS's
// share sheet only shows "Save to Files" for an actual document, so a
// plain-text share can never be saved as a file to open again later. A
// real file on disk gets that option, on both iOS and Android.
export async function exportDataToFile(data: unknown): Promise<ExportResult> {
  const date = new Date().toISOString().slice(0, 10);
  return shareTextFile(
    `safecircle-data-${date}.json`,
    JSON.stringify(data, null, 2),
    'application/json',
    'Save your Safe Circle data',
  );
}
