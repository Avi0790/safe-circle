// The theme follows the phone's appearance when the app starts.
const mockSetScheme = jest.fn();

function themeWith(scheme: 'light' | 'dark' | null, saved?: string) {
  let theme!: typeof import('@/lib/theme');
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({
      Appearance: { getColorScheme: () => scheme, setColorScheme: mockSetScheme },
      Platform: { OS: 'ios' },
      Settings: { get: () => saved, set: () => {} },
    }));
    theme = require('@/lib/theme');
  });
  return theme;
}

beforeEach(() => mockSetScheme.mockClear());

afterEach(() => jest.dontMock('react-native'));

describe('theme', () => {
  it('uses the light palette in light mode, and when the phone says nothing', () => {
    for (const scheme of ['light', null] as const) {
      const t = themeWith(scheme);
      expect(t.isDark).toBe(false);
      expect(t.colors).toMatchObject({ page: '#f3f2f8', card: '#ffffff', ink: '#0f172a', accentFill: '#7c3aed' });
    }
  });

  it('uses the dark palette in dark mode', () => {
    const t = themeWith('dark');
    expect(t.isDark).toBe(true);
    expect(t.colors).toMatchObject({ page: '#0b0c10', card: '#171a21', ink: '#f8fafc' });
    // white text on filled buttons needs the deeper violet, not the light text accent
    expect(t.colors.accentFill).toBe('#7c3aed');
    expect(t.colors.accent).not.toBe(t.colors.accentFill);
    // and SOS stays a strong red
    expect(t.colors.dangerFill).toBe('#dc2626');
  });

  it('both palettes define every colour', () => {
    expect(Object.keys(themeWith('dark').colors).sort()).toEqual(Object.keys(themeWith('light').colors).sort());
  });
});

describe('the Appearance choice', () => {
  it('Match iPhone (the default) follows the phone, and leaves iOS alone', () => {
    expect(themeWith('dark', 'system').isDark).toBe(true);
    expect(themeWith('light', undefined).isDark).toBe(false);
    expect(mockSetScheme).not.toHaveBeenCalled();
  });

  it('Dark or Light wins over the phone, and tells iOS so its own parts match', () => {
    expect(themeWith('light', 'dark').isDark).toBe(true);
    expect(mockSetScheme).toHaveBeenLastCalledWith('dark');
    expect(themeWith('dark', 'light').isDark).toBe(false);
    expect(mockSetScheme).toHaveBeenLastCalledWith('light');
  });

  it('ignores a saved value it does not know', () => {
    expect(themeWith('dark', 'purple').isDark).toBe(true);
    expect(mockSetScheme).not.toHaveBeenCalled();
  });
});
