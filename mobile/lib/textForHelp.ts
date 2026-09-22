import * as Location from 'expo-location';
import * as SMS from 'expo-sms';

export type TextForHelpResult =
  | { ok: true; sent: boolean }
  | { ok: false; error: string };

// Composes (does not silently send — the native composer still needs a
// tap) a text to the chosen phone numbers with a Google Maps link to your
// current location. The fallback for when push can't reach anyone: SOS,
// walks, curfew and everything else here depend on this phone *and*
// Supabase both having internet, and SMS can get through in places data
// can't.
export async function textForHelp(
  phoneNumbers: string[],
  note: string,
): Promise<TextForHelpResult> {
  if (phoneNumbers.length === 0) {
    return { ok: false, error: 'Choose at least one person to text.' };
  }

  const available = await SMS.isAvailableAsync();
  if (!available) {
    return { ok: false, error: 'Texting is not available on this device.' };
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, error: "Can't include your location without permission." };
  }

  let mapsLink = '';
  try {
    const position = await Location.getCurrentPositionAsync({});
    mapsLink = `https://www.google.com/maps/search/?api=1&query=${position.coords.latitude},${position.coords.longitude}`;
  } catch {
    // Send without a location link rather than blocking the text entirely
    // — a text saying "need help" with no map link still beats nothing.
  }

  const message = [note.trim() || 'I need help.', mapsLink].filter(Boolean).join('\n\n');

  const { result } = await SMS.sendSMSAsync(phoneNumbers, message);
  return { ok: true, sent: result === 'sent' || result === 'unknown' };
}
