import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { avatarPathFromUrl } from '@/lib/avatar';
import { base64ToBytes } from '@/lib/base64';

// Big enough to look sharp on the largest place an avatar is drawn (the
// 40pt Members row at 3x), small enough that a photo is ~30-80 KB instead
// of the multi-megabyte original — every circle member downloads it.
const AVATAR_SIZE_PX = 512;

export type AvatarChange =
  | { ok: true; url: string | null }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string };

// Lets the person pick + square-crop a photo, shrinks it, uploads it to the
// `avatars` bucket (see ...000023_avatar_photos.sql) under their own folder,
// points profiles.avatar_url at it, and deletes the photo it replaces.
export async function pickAndUploadAvatar(
  userId: string,
  previousUrl: string | null,
): Promise<AvatarChange> {
  try {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (picked.canceled || picked.assets.length === 0) return { ok: false, cancelled: true };

    const context = ImageManipulator.manipulate(picked.assets[0].uri);
    context.resize({ width: AVATAR_SIZE_PX });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
    if (!saved.base64) return { ok: false, error: "Couldn't read that photo." };

    // A fresh path per upload (rather than overwriting one fixed name) keeps
    // every client's image cache from serving the previous photo.
    const path = `${userId}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, base64ToBytes(saved.base64), { contentType: 'image/jpeg' });
    if (uploadError) return { ok: false, error: uploadError.message };

    const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: url })
      .eq('id', userId);
    if (updateError) {
      // Don't leave an orphaned upload behind if the profile write failed.
      await supabase.storage.from('avatars').remove([path]).catch(() => {});
      return { ok: false, error: updateError.message };
    }

    await deleteStoredAvatar(previousUrl);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

export async function removeAvatar(userId: string, currentUrl: string | null): Promise<AvatarChange> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) return { ok: false, error: error.message };
  await deleteStoredAvatar(currentUrl);
  return { ok: true, url: null };
}

// Best-effort: a photo left behind in storage is harmless, so a failure
// here should never surface as an error to the person who just changed theirs.
async function deleteStoredAvatar(url: string | null) {
  const path = avatarPathFromUrl(url);
  if (!path) return;
  await supabase.storage.from('avatars').remove([path]).catch(() => {});
}
