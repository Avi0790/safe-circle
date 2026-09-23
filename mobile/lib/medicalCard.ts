import type { MedicalCard } from '@/lib/types';

// One readable block for an alert dialog. Skips empty fields, and returns
// null when the card has nothing worth showing so the caller can say so.
export function formatMedicalCard(card: Partial<MedicalCard> | null | undefined): string | null {
  if (!card) return null;
  const lines: string[] = [];
  if (card.blood_type?.trim()) lines.push(`Blood type: ${card.blood_type.trim()}`);
  if (card.allergies?.trim()) lines.push(`Allergies: ${card.allergies.trim()}`);
  if (card.conditions?.trim()) lines.push(`Conditions: ${card.conditions.trim()}`);
  if (card.medications?.trim()) lines.push(`Medications: ${card.medications.trim()}`);
  if (card.notes?.trim()) lines.push(`Notes: ${card.notes.trim()}`);
  return lines.length > 0 ? lines.join('\n') : null;
}
