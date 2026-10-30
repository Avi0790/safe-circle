import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { applyLanguagePref, language, phoneLanguage, resolveLanguage, t } from '@/lib/i18n';
import { themeVersion } from '@/lib/theme';
import { es } from '@/lib/translations/es';

const ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'translations' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

// Every literal passed to t('...') or t("...") in the app.
const literals = ['app', 'components', 'lib'].flatMap((dir) =>
  sourceFiles(join(ROOT, dir)).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map((m) =>
      (m[1] ?? m[2]).replace(/\\(.)/g, '$1'),
    );
  }),
);
// Names and addresses that read the same in every language.
const SAME_IN_SPANISH = new Set(['Safe Circle', 'github.com/surendr7a/SafeCircle', 'Chat', 'Plan']);

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Spanish translations', () => {
  it('every English phrase wrapped in t() has Spanish', () => {
    const missing = [...new Set(literals)].filter((text) => !(text in es) && !SAME_IN_SPANISH.has(text));
    expect(missing).toEqual([]);
  });

  it('each translation keeps the same {placeholders} as its English', () => {
    const mismatched = Object.entries(es)
      .filter(([english, spanish]) => placeholders(english).join() !== placeholders(spanish).join())
      .map(([english]) => english);
    expect(mismatched).toEqual([]);
  });

  it('no translation is left empty or identical by mistake', () => {
    const suspicious = Object.entries(es)
      .filter(([english, spanish]) => !spanish.trim() || (spanish === english && !SAME_IN_SPANISH.has(english)))
      .map(([english]) => english);
    expect(suspicious).toEqual([]);
  });
});

describe('t() and switching language', () => {
  afterEach(() => applyLanguagePref('en'));

  it('the phone language decides, unless a language is chosen', () => {
    expect(resolveLanguage('system', 'es')).toBe('es');
    expect(resolveLanguage('system', 'en')).toBe('en');
    expect(resolveLanguage('en', 'es')).toBe('en');
    expect(resolveLanguage('es', 'en')).toBe('es');
    expect(['en', 'es']).toContain(phoneLanguage());
  });

  it('English is the text itself, with placeholders filled', () => {
    applyLanguagePref('en');
    expect(t('Clocked in to {org}', { org: 'Riverside' })).toBe('Clocked in to Riverside');
  });

  it('Spanish looks the English up, and fills the same placeholders', () => {
    applyLanguagePref('es');
    expect(language()).toBe('es');
    expect(t('Sign in')).toBe('Iniciar sesión');
    expect(t('Clocked in to {org}', { org: 'Riverside' })).toBe('Entrada marcada en Riverside');
  });

  it('anything not translated yet stays English rather than showing a key', () => {
    applyLanguagePref('es');
    expect(t('A sentence nobody has translated')).toBe('A sentence nobody has translated');
  });

  it('switching redraws every screen at once', () => {
    applyLanguagePref('en');
    const before = themeVersion();
    applyLanguagePref('es');
    expect(themeVersion()).toBe(before + 1);
    applyLanguagePref('es'); // no change, no redraw
    expect(themeVersion()).toBe(before + 1);
  });

  it('the choice is kept in iOS settings and used from the first screen next time', () => {
    const saved: Record<string, unknown> = {};
    const load = () => {
      let i18n!: typeof import('@/lib/i18n');
      jest.isolateModules(() => {
        jest.doMock('react-native', () => ({
          Appearance: { getColorScheme: () => 'light', setColorScheme: () => {}, addChangeListener: () => ({ remove: () => {} }) },
          Platform: { OS: 'ios' },
          Settings: { get: (key: string) => saved[key], set: (values: Record<string, unknown>) => Object.assign(saved, values) },
        }));
        i18n = require('@/lib/i18n');
      });
      jest.dontMock('react-native');
      return i18n;
    };
    const first = load();
    first.applyLanguagePref('es');
    expect(saved['safecircle.language']).toBe('es');
    const next = load(); // the app opening again
    expect(next.getLanguagePref()).toBe('es');
    expect(next.t('Sign in')).toBe('Iniciar sesión');
  });
});
