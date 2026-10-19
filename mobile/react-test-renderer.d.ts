// react-test-renderer ships no types and we only use a sliver of it (mounting
// a component in a test and finding things in the result); this covers
// exactly that.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';
  export interface ReactTestInstance {
    type: unknown;
    props: Record<string, any>;
    children: (ReactTestInstance | string)[];
    findByType(type: unknown): ReactTestInstance;
    findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  }
  export interface ReactTestRenderer {
    root: ReactTestInstance;
    toJSON(): unknown;
    unmount(): void;
  }
  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => Promise<void> | void): Promise<void>;
}
