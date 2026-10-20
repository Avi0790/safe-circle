// react-test-renderer ships no types and we only use a sliver of it (mounting
// a component in a test, re-rendering it and finding things in the result); this covers
// exactly that.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';
  export interface ReactTestInstance {
    type: unknown;
    props: Record<string, any>;
    children: (ReactTestInstance | string)[];
    parent: ReactTestInstance | null;
    findByType(type: unknown): ReactTestInstance;
    findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  }
  export interface ReactTestRenderer {
    root: ReactTestInstance;
    toJSON(): unknown;
    update(element: ReactElement): void;
    unmount(): void;
  }
  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => Promise<void> | void): Promise<void>;
}
