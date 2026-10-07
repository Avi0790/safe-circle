// react-test-renderer ships no types and we only use a sliver of it (mounting
// a component in a test); this covers exactly that.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';
  export interface ReactTestRenderer {
    toJSON(): unknown;
    unmount(): void;
  }
  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => Promise<void> | void): Promise<void>;
}
