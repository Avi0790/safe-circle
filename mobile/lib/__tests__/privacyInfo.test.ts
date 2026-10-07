/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import { PRIVACY_LIMITS, PRIVACY_SECTIONS } from '../privacyInfo';

const APP_DIR = path.resolve(__dirname, '../../app/(app)');
const layout = fs.readFileSync(path.join(APP_DIR, '_layout.tsx'), 'utf8');

describe('privacy screen content', () => {
  it('has unique section ids and non-empty text', () => {
    const ids = PRIVACY_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of PRIVACY_SECTIONS) {
      expect(s.title.trim()).not.toBe('');
      expect(s.body.trim()).not.toBe('');
    }
    expect(PRIVACY_LIMITS.length).toBeGreaterThan(0);
  });

  it('every action button goes to a screen that exists and is registered', () => {
    for (const s of PRIVACY_SECTIONS) {
      if (!s.action) continue;
      const name = s.action.route.replace(/^\//, '');
      expect(fs.existsSync(path.join(APP_DIR, `${name}.tsx`))).toBe(true);
      expect(layout).toContain(`name="${name}"`);
    }
  });

  it('the privacy screen itself is registered', () => {
    expect(layout).toContain('name="privacy"');
  });
});
