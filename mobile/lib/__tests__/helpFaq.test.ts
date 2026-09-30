import { findFaqAnswer, HELP_FAQ } from '../helpFaq';

describe('findFaqAnswer', () => {
  it('matches a question using the entry it was written for', () => {
    for (const entry of HELP_FAQ) {
      expect(findFaqAnswer(entry.question)).toBe(entry.answer);
    }
  });

  it('is case-insensitive', () => {
    expect(findFaqAnswer('WHAT DOES GHOST MODE DO?')).toBe(
      HELP_FAQ.find((e) => e.id === 'ghost-mode')!.answer,
    );
  });

  it('prefers a longer phrase match over a shorter one embedded in a different topic', () => {
    // "home" alone appears in several unrelated entries' keywords/answers,
    // but the multi-word phrase should win outright.
    expect(findFaqAnswer('how does walk me home work')).toBe(
      HELP_FAQ.find((e) => e.id === 'walk-me-home')!.answer,
    );
  });

  it('returns null for a question that matches nothing', () => {
    expect(findFaqAnswer('what is the capital of France')).toBeNull();
  });

  it('every entry has at least one keyword that appears in its own question', () => {
    // Guards against a typo'd keyword list silently making an entry
    // unreachable from its own starter chip.
    for (const entry of HELP_FAQ) {
      const q = entry.question.toLowerCase();
      expect(entry.keywords.some((k) => q.includes(k))).toBe(true);
    }
  });
});
