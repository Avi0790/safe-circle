// Life360-style place icons, inferred from the name rather than a stored
// category — places has no category column, and guessing from the name
// the user already typed ("Home", "Mom's Work") needs no schema change or
// extra input step when adding one.
export function placeIcon(name: string): string {
  const lower = name.toLowerCase()
  if (/\bhome\b|\bhouse\b/.test(lower)) return '🏠'
  if (/school|college|university/.test(lower)) return '🏫'
  if (/\bwork\b|office/.test(lower)) return '💼'
  if (/gym|fitness/.test(lower)) return '🏋️'
  if (/hospital|clinic|doctor/.test(lower)) return '🏥'
  return '📍'
}
