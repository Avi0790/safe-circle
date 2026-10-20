// Helpers for screen tests built on react-test-renderer: read what's on
// screen, and press things by what they say (or their accessibility label).
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactElement } from 'react';

export function text(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return ((node as { children?: unknown[] }).children ?? []).map(text).join('');
}

export const allText = (r: ReactTestRenderer) => text(r.toJSON());

// Let pending promises (server calls, effects) settle.
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const mounted: ReactTestRenderer[] = [];

export async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(element);
  });
  mounted.push(r);
  await flush();
  return r;
}

// Unmount everything render() mounted (call in afterEach), so timers and
// subscriptions a screen leaves running can't fire after its test ends.
export async function unmountAll() {
  while (mounted.length) {
    const r = mounted.pop()!;
    await act(async () => r.unmount());
  }
}

// Things you can press whose text includes `label`, or whose accessibility
// label is exactly `label`; innermost first, so a button inside a row wins
// over the row itself.
export function pressables(r: ReactTestRenderer, label: string): ReactTestInstance[] {
  const hits = r.root.findAll(
    (n) =>
      typeof n.props.onPress === 'function' &&
      !n.props.disabled &&
      (text({ children: n.children }).includes(label) || n.props.accessibilityLabel === label),
  );
  // drop any hit that contains another hit
  return hits.filter((h) => !hits.some((o) => o !== h && contains(h, o)));
}

function contains(outer: ReactTestInstance, inner: ReactTestInstance): boolean {
  return outer.findAll((n) => n === inner).length > 0;
}

export async function press(r: ReactTestRenderer, label: string, index = 0) {
  const hits = pressables(r, label);
  if (!hits[index]) throw new Error(`Nothing pressable says "${label}" (found ${hits.length})`);
  await act(async () => {
    await hits[index].props.onPress();
  });
  await flush();
}

// Tap a button of an Alert.alert the screen showed (Alert itself spied on
// with jest.spyOn(Alert, 'alert')), the way a person would: inside act().
export async function tapAlertButton(alert: jest.SpyInstance, buttonText: string, callIndex = 0) {
  const buttons = (alert.mock.calls[callIndex]?.[2] ?? []) as { text: string; onPress?: () => unknown }[];
  const button = buttons.find((b) => b.text === buttonText);
  if (!button) throw new Error(`Alert ${callIndex} has no "${buttonText}" button`);
  await act(async () => {
    await button.onPress?.();
  });
  await flush();
}

// The Switch that belongs to `label`: from the text, go up to the nearest
// container that holds exactly one Switch.
export function switchFor(r: ReactTestRenderer, label: string, SwitchType: unknown): ReactTestInstance {
  const labels = r.root.findAll(
    (n) => typeof n.type === 'string' && n.children.some((c) => typeof c === 'string' && c.includes(label)),
  );
  for (const l of labels) {
    let node: ReactTestInstance | null = l;
    while (node) {
      const switches = node.findAll((n) => n.type === SwitchType);
      if (switches.length === 1) return switches[0];
      if (switches.length > 1) break;
      node = node.parent;
    }
  }
  throw new Error(`No switch next to "${label}"`);
}

export async function toggle(sw: ReactTestInstance, value: boolean) {
  await act(async () => {
    await sw.props.onValueChange(value);
  });
  await flush();
}
