import React from 'react';
import { act, create } from 'react-test-renderer';
import { InviteQr } from '../InviteQr';
import { buildJoinPayload } from '@/lib/joinCode';
import { qrMatrix } from '@/lib/qr';

// Every module is its own view; count the leaf cells and the dark ones and
// compare with the matrix the encoder produced.
function leaves(node: any, out: any[] = []): any[] {
  if (!node || typeof node === 'string') return out;
  if (!node.children || node.children.length === 0) out.push(node);
  else node.children.forEach((c: unknown) => leaves(c, out));
  return out;
}

describe('InviteQr', () => {
  it('draws one cell per module, dark where the matrix is dark', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<InviteQr code="AB23CD" size={200} />);
    });
    const matrix = qrMatrix(buildJoinPayload('AB23CD'));
    const cells = leaves(tree!.toJSON());
    const n = matrix.length;
    expect(cells).toHaveLength(n * n);
    const darkExpected = matrix.flat().filter(Boolean).length;
    const darkRendered = cells.filter((c) => JSON.stringify(c.props.style).includes('#000000')).length;
    expect(darkRendered).toBe(darkExpected);
  });

  it('labels itself for screen readers with the code', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<InviteQr code="AB23CD" />);
    });
    expect((tree!.toJSON() as any).props.accessibilityLabel).toBe('QR code for invite code AB23CD');
  });
});
