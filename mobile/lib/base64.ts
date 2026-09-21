// Hermes ships atob, so no polyfill package is needed to turn the
// manipulator's base64 output into bytes supabase-js can upload.
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
