import { formatMedicalCard } from '../medicalCard';

describe('formatMedicalCard', () => {
  it('returns null for no card or an empty one', () => {
    expect(formatMedicalCard(null)).toBeNull();
    expect(formatMedicalCard(undefined)).toBeNull();
    expect(formatMedicalCard({ blood_type: '  ', allergies: null })).toBeNull();
  });

  it('lists only the fields that are filled in, trimmed', () => {
    expect(
      formatMedicalCard({ blood_type: ' O+ ', allergies: 'Penicillin', conditions: null, notes: 'Wears a medical bracelet' }),
    ).toBe('Blood type: O+\nAllergies: Penicillin\nNotes: Wears a medical bracelet');
  });
});
