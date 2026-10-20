import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AvatarPicker } from '../AvatarPicker';
import { text } from '../../test-support/render';

// The picker with its real drawings (react-native-svg renders as plain
// elements in tests).
async function mount(onDone = jest.fn(), onClose = jest.fn()) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<AvatarPicker value={{ style: 'sedan', color: 'black' }} onDone={onDone} onClose={onClose} />);
  });
  return { r, onDone, onClose };
}
const tap = (r: ReactTestRenderer, label: string) =>
  act(async () => {
    const hit = r.root.findAll((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || text({ children: n.children }) === label));
    if (!hit[0]) throw new Error(`no ${label}`);
    await hit[0].props.onPress();
  });
const selected = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.props.accessibilityState?.selected === true && typeof n.props.onPress === 'function').map((n) => n.props.accessibilityLabel);
const allText = (r: ReactTestRenderer) => text(r.toJSON());

describe('AvatarPicker', () => {
  it('starts on your current avatar and colour, by name', async () => {
    const { r } = await mount();
    expect(selected(r)).toEqual(['Avatar: Sedan', 'Colour: Night black']);
    expect(allText(r)).toContain('Night black');
    expect(allText(r)).toContain('Sedan');
  });

  it('changes nothing until Done', async () => {
    const { r, onDone, onClose } = await mount();
    await tap(r, 'Avatar: Race car');
    await tap(r, 'Colour: Sunshine yellow');
    expect(allText(r)).toContain('Sunshine yellow');
    expect(onDone).not.toHaveBeenCalled();
    await tap(r, 'Done');
    expect(onDone).toHaveBeenCalledWith({ style: 'race', color: 'yellow' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('✕ closes without saving', async () => {
    const { r, onDone, onClose } = await mount();
    await tap(r, 'Avatar: Classic');
    await tap(r, 'Close');
    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Reset goes back to the blue arrow', async () => {
    const { r, onDone } = await mount();
    await tap(r, 'Reset');
    expect(selected(r)).toEqual(['Avatar: Navigation arrow', 'Colour: Ocean blue']);
    await tap(r, 'Done');
    expect(onDone).toHaveBeenCalledWith({ style: 'arrow', color: 'blue' });
  });

  it('draws every avatar without failing', async () => {
    const { r } = await mount();
    expect(
      r.root.findAll(
        (n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Avatar: '),
      ),
    ).toHaveLength(7);
  });
});
