import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { WelcomeTour } from '../WelcomeTour';
import { showTourAgain, TOUR_PAGES, tourSeen } from '@/lib/tour';
import { es } from '@/lib/translations/es';
import { allText, render, text, unmountAll } from '../../test-support/render';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));

function press(r: ReactTestRenderer, label: string) {
  const hit = r.root.findAll(
    (n: ReactTestInstance) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || text({ children: n.children }) === label),
  );
  if (!hit[0]) throw new Error(`no ${label}`);
  return act(async () => hit[0].props.onPress());
}

describe('WelcomeTour', () => {
  beforeEach(() => AsyncStorage.clear());
  afterEach(unmountAll);

  it('shows on the first launch and walks through every page', async () => {
    const r = await render(<WelcomeTour />);
    expect(allText(r)).toContain('Welcome to Safe Circle');
    for (let i = 1; i < TOUR_PAGES.length; i++) {
      await press(r, 'Next');
      expect(allText(r)).toContain(TOUR_PAGES[i].title);
    }
    await press(r, 'Back');
    expect(allText(r)).toContain(TOUR_PAGES[TOUR_PAGES.length - 2].title);
    await press(r, 'Next');
    await press(r, 'Get started');
    expect(r.toJSON()).toBeNull();
    expect(await tourSeen()).toBe(true);
  });

  it('can be skipped, and then stays away', async () => {
    const r = await render(<WelcomeTour />);
    await press(r, 'Skip');
    expect(r.toJSON()).toBeNull();
    const again = await render(<WelcomeTour />);
    expect(again.toJSON()).toBeNull();
  });

  it('comes back from Settings, from the first page', async () => {
    await AsyncStorage.setItem('safecircle.tour.seen.v1', '1');
    const r = await render(<WelcomeTour />);
    expect(r.toJSON()).toBeNull();
    await act(async () => showTourAgain());
    expect(allText(r)).toContain('Welcome to Safe Circle');
  });

  it('every page is in Spanish', () => {
    for (const p of TOUR_PAGES) {
      expect(es[p.title]).toBeTruthy();
      expect(es[p.body]).toBeTruthy();
    }
  });
});
