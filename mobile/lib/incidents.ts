import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { base64ToBytes } from '@/lib/base64';
import { supabase } from '@/lib/supabase';

// Incident and hazard reports at work (migration ...000072). A report is a
// kind, a note, an optional photo and, only while clocked in there, the
// position. The database decides who's told and who can read it.

export type IncidentKind = 'hazard' | 'near_miss' | 'injury' | 'other';

export const INCIDENT_KINDS: { kind: IncidentKind; emoji: string; label: string }[] = [
  { kind: 'hazard', emoji: '⚠️', label: 'Hazard' },
  { kind: 'near_miss', emoji: '😮', label: 'Near miss' },
  { kind: 'injury', emoji: '🩹', label: 'Injury' },
  { kind: 'other', emoji: '📝', label: 'Other' },
];

export function incidentKindInfo(kind: string) {
  return INCIDENT_KINDS.find((k) => k.kind === kind) ?? INCIDENT_KINDS[3];
}

export interface IncidentReport {
  id: string;
  org_id: string;
  user_id: string;
  kind: IncidentKind;
  note: string;
  latitude: number | null;
  longitude: number | null;
  photo_path: string | null;
  status: 'open' | 'resolved';
  resolved_at: string | null;
  created_at: string;
  profiles?: { full_name: string } | null;
}

export const NOTE_MAX = 1000;
const PHOTO_WIDTH_PX = 1280; // readable detail, ~150-300 KB

export type PhotoResult = { ok: true; uri: string } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; error: string };

// Take a photo (or pick one) for a report. Kept on the phone until the report
// is sent.
export async function pickIncidentPhoto(source: 'camera' | 'library'): Promise<PhotoResult> {
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { ok: false, error: 'Camera access is off for Safe Circle.' };
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const picked =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || picked.assets.length === 0) return { ok: false, cancelled: true };
    return { ok: true, uri: picked.assets[0].uri };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

// The storage path a report's photo goes to: <org>/<you>/<time>.jpg, the
// only folder the storage rules let you write to for that organization.
export function incidentPhotoPath(orgId: string, userId: string, now = Date.now()): string {
  return `${orgId}/${userId}/${now}.jpg`;
}

export type SubmitResult = { ok: true; id: string } | { ok: false; error: string };

export async function submitIncident(input: {
  orgId: string;
  userId: string;
  kind: IncidentKind;
  note: string;
  photoUri?: string | null;
  position?: { latitude: number; longitude: number } | null;
}): Promise<SubmitResult> {
  const note = input.note.trim();
  if (!note) return { ok: false, error: 'Say what happened.' };
  if (note.length > NOTE_MAX) return { ok: false, error: 'Keep it under 1000 characters.' };

  let photoPath: string | null = null;
  if (input.photoUri) {
    try {
      const context = ImageManipulator.manipulate(input.photoUri);
      context.resize({ width: PHOTO_WIDTH_PX });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
      if (!saved.base64) return { ok: false, error: "Couldn't read that photo." };
      photoPath = incidentPhotoPath(input.orgId, input.userId);
      const { error } = await supabase.storage
        .from('incident-photos')
        .upload(photoPath, base64ToBytes(saved.base64), { contentType: 'image/jpeg' });
      if (error) return { ok: false, error: error.message };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't send the photo." };
    }
  }

  const { data, error } = await supabase.rpc('report_incident', {
    p_org: input.orgId,
    p_kind: input.kind,
    p_note: note,
    p_latitude: input.position?.latitude ?? null,
    p_longitude: input.position?.longitude ?? null,
    p_photo_path: photoPath,
  });
  if (error) {
    if (photoPath) await supabase.storage.from('incident-photos').remove([photoPath]).catch(() => {});
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data as string };
}

// A short-lived link to a report's photo, for whoever may read the report.
export async function incidentPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('incident-photos').createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}
