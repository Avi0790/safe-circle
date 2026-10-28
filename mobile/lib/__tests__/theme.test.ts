// The theme follows the phone's appearance when the app starts.
const mockSetScheme = jest.fn();
const mockPhoneListeners: ((e: { colorScheme: string }) => void)[] = [];

function themeWith(scheme: 'light' | 'dark' | null, saved?: string) {
  let theme!: typeof import('@/lib/theme');
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({
      Appearance: {
        getColorScheme: () => scheme,
        setColorScheme: mockSetScheme,
        addChangeListener: (l: (e: { colorScheme: string }) => void) => {
          mockPhoneListeners.push(l);
          return { remove: () => mockPhoneListeners.splice(mockPhoneListeners.indexOf(l), 1) };
        },
      },
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

describe('switching while the app is open', () => {
  it('swaps the colours in place, so everything reading them sees the new theme', () => {
    const t = themeWith('light', 'system');
    const sameObject = t.colors;
    t.applyColorScheme('dark');
    expect(t.isDark).toBe(true);
    expect(t.colors).toBe(sameObject);
    expect(t.colors.page).toBe('#0b0c10');
  });

  it('rebuilds a themed style sheet once after a switch, and not before', () => {
    const t = themeWith('light', 'system');
    const factory = jest.fn(() => ({ box: { backgroundColor: t.colors.card } }));
    const styles = t.themed(factory);
    expect(styles.box.backgroundColor).toBe('#ffffff');
    expect(styles.box.backgroundColor).toBe('#ffffff');
    expect(factory).toHaveBeenCalledTimes(1);
    t.applyColorScheme('dark');
    expect(styles.box.backgroundColor).toBe('#171a21');
    expect(factory).toHaveBeenCalledTimes(2);
    expect({ ...styles }).toEqual({ box: { backgroundColor: '#171a21' } }); // spreads work too
    expect(t.typography.title.color).toBe('#f8fafc');
  });

  it('counts switches (what screens subscribe to), and ignores a switch to the same theme', () => {
    const t = themeWith('light', 'system');
    const before = t.themeVersion();
    t.applyColorScheme('light');
    expect(t.themeVersion()).toBe(before);
    t.applyColorScheme('dark');
    expect(t.themeVersion()).toBe(before + 1);
  });

  it('a new choice in Settings applies at once, and tells iOS', () => {
    const t = themeWith('light', 'system');
    t.applyAppearancePref('dark');
    expect(t.isDark).toBe(true);
    expect(mockSetScheme).toHaveBeenLastCalledWith('dark');
    t.applyAppearancePref('system');
    expect(mockSetScheme).toHaveBeenLastCalledWith('unspecified');
    expect(t.isDark).toBe(false); // the phone is light
  });

  it('with Match iPhone, follows the phone switching while the app is open', () => {
    mockPhoneListeners.length = 0;
    const t = themeWith('light', 'system');
    const stop = t.followPhoneAppearance();
    mockPhoneListeners.forEach((l) => l({ colorScheme: 'dark' }));
    expect(t.isDark).toBe(true);
    stop();
    expect(mockPhoneListeners).toHaveLength(0);
  });

  it('with Dark chosen, ignores the phone switching', () => {
    mockPhoneListeners.length = 0;
    const t = themeWith('light', 'dark');
    t.followPhoneAppearance();
    mockPhoneListeners.forEach((l) => l({ colorScheme: 'light' }));
    expect(t.isDark).toBe(true);
  });
});
