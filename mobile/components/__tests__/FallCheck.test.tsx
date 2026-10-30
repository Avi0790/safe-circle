import React from 'react';
import { AccessibilityInfo, Vibration } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { FallCheck } from '../FallCheck';
import { FALL_COUNTDOWN_SECONDS, FALL_SOS_MESSAGE } from '@/lib/fallDetector';
import { applyLanguagePref } from '@/lib/i18n';
import { localizeSosMessage } from '@/lib/sosMessages';
import { text } from '../../test-support/render';

function button(r: ReactTestRenderer, label: string): ReactTestInstance {
  const hit = r.root.findAll(
    (n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || text({ children: n.children }) === label),
  );
  if (!hit[0]) throw new Error(`no ${label}`);
  return hit[0];
}

describe('FallCheck: "Are you OK?" after a possible fall', () => {
  let vibrate: jest.SpyInstance;
  let cancel: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
    cancel = jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function open(onDismiss = jest.fn(), onSend = jest.fn()) {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<FallCheck visible onDismiss={onDismiss} onSend={onSend} />);
    });
    return { r, onDismiss, onSend };
  }

  it('asks, vibrates, and counts down from 30 without sending anything yet', async () => {
    const { r, onSend } = await open();
    expect(text(r.toJSON())).toContain('Are you OK?');
    expect(text(r.toJSON())).toContain(String(FALL_COUNTDOWN_SECONDS));
    expect(vibrate).toHaveBeenCalledWith(expect.any(Array), true);
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(text(r.toJSON())).toContain('20');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('"I\'m OK" stops it: nothing is sent', async () => {
    const { r, onDismiss, onSend } = await open();
    await act(async () => button(r, "I'm OK").props.onPress());
    expect(onDismiss).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('no answer for 30 seconds sends the SOS once, saying why, and stops vibrating', async () => {
    const { onSend } = await open();
    await act(async () => jest.advanceTimersByTime(FALL_COUNTDOWN_SECONDS * 1000 + 2000));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(FALL_SOS_MESSAGE);
    expect(cancel).toHaveBeenCalled();
  });

  it('"Send SOS now" sends straight away, and only once', async () => {
    const { r, onSend } = await open();
    await act(async () => button(r, 'Send SOS now').props.onPress());
    await act(async () => jest.advanceTimersByTime(FALL_COUNTDOWN_SECONDS * 1000));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('automatic SOS messages in the reader\'s language', () => {
  afterEach(() => applyLanguagePref('en'));

  it('translates the fixed ones and leaves typed ones alone', () => {
    applyLanguagePref('es');
    expect(localizeSosMessage(FALL_SOS_MESSAGE)).toMatch(/^Alerta automática: se detectó una posible caída/);
    expect(
      localizeSosMessage("Automatic alert: didn't arrive at Home before their walk timer ran out. This is their last known location."),
    ).toBe('Alerta automática: no llegó a Home antes de que se acabara su tiempo de caminata. Esta es su última ubicación conocida.');
    expect(localizeSosMessage('Car broke down on 63')).toBe('Car broke down on 63');
    applyLanguagePref('en');
    expect(localizeSosMessage(FALL_SOS_MESSAGE)).toBe(FALL_SOS_MESSAGE);
  });
});
