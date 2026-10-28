import { phoneTimeZone } from '@/lib/timeZone';

describe('phoneTimeZone', () => {
  it("returns the phone's named time zone", () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'America/Chicago' }),
    } as unknown as Intl.DateTimeFormat);
    expect(phoneTimeZone()).toBe('America/Chicago');
    spy.mockRestore();
  });

  it('falls back to UTC if the phone gives none, or Intl fails', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: '' }),
    } as unknown as Intl.DateTimeFormat);
    expect(phoneTimeZone()).toBe('UTC');
    spy.mockImplementation(() => {
      throw new Error('no Intl');
    });
    expect(phoneTimeZone()).toBe('UTC');
    spy.mockRestore();
  });
});
