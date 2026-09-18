import { placeIcon } from '../places';

describe('placeIcon', () => {
  it('recognizes home', () => {
    expect(placeIcon('Home')).toBe('🏠');
    expect(placeIcon("Mom's House")).toBe('🏠');
  });

  it('recognizes school', () => {
    expect(placeIcon('School')).toBe('🏫');
    expect(placeIcon('Arkansas State University')).toBe('🏫');
  });

  it('recognizes work', () => {
    expect(placeIcon('Work')).toBe('💼');
    expect(placeIcon("Dad's Office")).toBe('💼');
  });

  it('is case-insensitive', () => {
    expect(placeIcon('HOME')).toBe('🏠');
  });

  it('does not false-positive on substrings (e.g. "Homestead")', () => {
    expect(placeIcon('Homestead Park')).toBe('📍');
  });

  it('falls back to a generic pin for anything else', () => {
    expect(placeIcon("Grandma's")).toBe('📍');
    expect(placeIcon('JTown Grill')).toBe('📍');
  });
});
