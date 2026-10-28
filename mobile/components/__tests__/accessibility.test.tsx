import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Button } from '../Button';
import { ErrorText } from '../ErrorText';
import { TextField } from '../TextField';
import { announce } from '@/lib/announce';

async function mount(el: React.ReactElement) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  return r;
}

function one(r: ReactTestRenderer, match: (n: ReactTestInstance) => boolean): ReactTestInstance {
  const hit = r.root.findAll(match);
  if (!hit[0]) throw new Error('not found');
  return hit[0];
}

describe('what VoiceOver hears', () => {
  let spoken: jest.SpyInstance;
  beforeEach(() => {
    spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });
  afterEach(() => spoken.mockRestore());

  it('a Button is a named button that says when it is busy or unavailable', async () => {
    const r = await mount(<Button title="Save curfew" onPress={() => {}} loading />);
    const button = one(r, (n) => n.props.accessibilityRole === 'button');
    expect(button.props.accessibilityLabel).toBe('Save curfew');
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it('a text field is named by its label, which is not read twice', async () => {
    const r = await mount(<TextField label="Email" placeholder="you@example.com" />);
    const input = one(r, (n) => n.props.placeholder === 'you@example.com' && n.props.accessibilityLabel);
    expect(input.props.accessibilityLabel).toBe('Email');
    const visible = one(r, (n) => n.props.importantForAccessibility === 'no');
    expect(visible.props.accessible).toBe(false);
  });

  it('an error is read out when it appears, and again when it changes', async () => {
    const r = await mount(<ErrorText>Choose a time.</ErrorText>);
    expect(spoken).toHaveBeenLastCalledWith('Choose a time.');
    await act(async () => r.update(<ErrorText>Place not found.</ErrorText>));
    expect(spoken).toHaveBeenLastCalledWith('Place not found.');
    expect(one(r, (n) => n.props.accessibilityRole === 'alert')).toBeTruthy();
  });

  it('no error, nothing shown or said', async () => {
    const r = await mount(<ErrorText>{null}</ErrorText>);
    expect(r.toJSON()).toBeNull();
    expect(spoken).not.toHaveBeenCalled();
  });

  it('announce ignores empty messages', () => {
    announce('');
    announce(null);
    expect(spoken).not.toHaveBeenCalled();
    announce('SOS sent');
    expect(spoken).toHaveBeenCalledWith('SOS sent');
  });
});
