import { buildJoinPayload, parseJoinCode } from '../joinCode';
import { qrMatrix } from '../qr';

describe('buildJoinPayload / parseJoinCode', () => {
  it('round-trips a code', () => {
    expect(parseJoinCode(buildJoinPayload('AB23CD'))).toBe('AB23CD');
  });

  it('normalises case and whitespace', () => {
    expect(buildJoinPayload(' ab23cd ')).toBe('SAFECIRCLE-JOIN:AB23CD');
    expect(parseJoinCode('  safecircle-join:ab23cd ')).toBe('AB23CD');
  });

  it('accepts a bare code and a safecircle:// link', () => {
    expect(parseJoinCode('ab23cd')).toBe('AB23CD');
    expect(parseJoinCode('safecircle://join?code=ab23cd')).toBe('AB23CD');
  });

  it('rejects anything that is not a valid invite code', () => {
    expect(parseJoinCode('https://example.com/?code=AB23CD')).toBeNull();
    expect(parseJoinCode('SAFECIRCLE-JOIN:SHORT')).toBeNull();
    expect(parseJoinCode('SAFECIRCLE-JOIN:AB23C0')).toBeNull(); // 0 is not in the alphabet
    expect(parseJoinCode('WIFI:S:home;T:WPA;P:secret;;')).toBeNull();
    expect(parseJoinCode('')).toBeNull();
  });
});

describe('qrMatrix', () => {
  it('produces a square grid with the three finder patterns', () => {
    const m = qrMatrix(buildJoinPayload('AB23CD'));
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === n)).toBe(true);
    // finder pattern: a dark 7-module bar on the top row, in the top-left,
    // top-right and bottom-left corners
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let i = 0; i < 7; i++) expect(m[r][c + i]).toBe(true);
    }
  });

  it('is deterministic and differs between codes', () => {
    const a = qrMatrix(buildJoinPayload('AB23CD'));
    expect(qrMatrix(buildJoinPayload('AB23CD'))).toEqual(a);
    expect(qrMatrix(buildJoinPayload('ZZ99AA'))).not.toEqual(a);
  });
});
