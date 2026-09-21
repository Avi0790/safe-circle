import { base64ToBytes } from '../base64';

describe('base64ToBytes', () => {
  it('decodes to the original bytes', () => {
    expect(Array.from(base64ToBytes('AAECA/8='))).toEqual([0, 1, 2, 3, 255]);
  });

  it('decodes an empty string to no bytes', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});
