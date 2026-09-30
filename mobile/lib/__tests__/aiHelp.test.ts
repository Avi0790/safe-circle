jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { supabase } from '@/lib/supabase';
import { askHelp } from '../aiHelp';

describe('askHelp', () => {
  it('rejects an empty question without calling the function', async () => {
    const result = await askHelp('   ', []);
    expect(result).toEqual({ ok: false, error: 'Ask something first.' });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('rejects an over-length question without calling the function', async () => {
    const result = await askHelp('x'.repeat(501), []);
    expect(result.ok).toBe(false);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('reads the real error message out of a failed function response', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'Too many questions this hour — try again later.' }) },
      },
    });
    const result = await askHelp('How does curfew work?', []);
    expect(result).toEqual({ ok: false, error: 'Too many questions this hour — try again later.' });
  });

  it('returns the answer on success', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { answer: 'Curfew alerts your circle if you are not home by a set time.' },
      error: null,
    });
    const result = await askHelp('How does curfew work?', []);
    expect(result).toEqual({ ok: true, answer: 'Curfew alerts your circle if you are not home by a set time.' });
  });
});
