jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { applyLanguagePref } from '@/lib/i18n';
import { instructionText, laneHint, nextAnnouncement } from '@/lib/navigation';
import { tripEtaText } from '@/lib/sharedTrips';

// Turn-by-turn directions, built and spoken in Spanish when the app is.
beforeAll(() => applyLanguagePref('es'));
afterAll(() => applyLanguagePref('en'));

describe('directions in Spanish', () => {
  it('says each kind of manoeuvre the way Spanish speakers give directions', () => {
    expect(instructionText({ type: 'turn', modifier: 'left', name: 'Main St' })).toBe('Gira a la izquierda hacia Main St');
    expect(instructionText({ type: 'turn', modifier: 'straight', name: 'Main St' })).toBe('Sigue derecho por Main St');
    expect(instructionText({ type: 'depart', modifier: 'right', name: 'Oak Ave' })).toBe('Sal a la derecha por Oak Ave');
    expect(instructionText({ type: 'roundabout', exit: 2, name: 'Caraway Rd' })).toBe('En la glorieta, toma la segunda salida hacia Caraway Rd');
    expect(instructionText({ type: 'fork', modifier: 'slight right', name: '' })).toBe('En la bifurcación, mantente a la derecha');
    expect(instructionText({ type: 'off ramp', name: 'I-555' })).toBe('Toma la salida hacia I-555');
    expect(instructionText({ type: 'arrive', name: '' })).toBe('Llegaste a tu destino');
  });

  it('names lanes', () => {
    const lane = (valid: boolean) => ({ valid, indications: [] as string[] });
    expect(laneHint([lane(true), lane(false), lane(false)])).toBe('Usa el carril izquierdo.');
    expect(laneHint([lane(false), lane(true), lane(true)])).toBe('Usa los 2 carriles de la derecha.');
  });

  it('announces the turn ahead in Spanish', () => {
    const step = { type: 'turn', modifier: 'right', name: 'Main St', instruction: 'Gira a la derecha hacia Main St' };
    const far = nextAnnouncement(0, 380, [step] as never, new Set());
    expect(far?.text).toBe('En un cuarto de milla, gira a la derecha hacia Main St.');
    const arrive = nextAnnouncement(0, 50, [{ type: 'arrive', name: '', instruction: '' }] as never, new Set());
    expect(arrive?.text).toBe('Tu destino está justo adelante.');
  });

  it('describes a shared trip’s ETA', () => {
    const now = Date.parse('2026-10-30T18:00:00Z');
    expect(tripEtaText('2026-10-30T18:25:00Z', now, 'drive')).toMatch(/^llega en unos 25 min \(/);
    expect(tripEtaText('2026-10-30T17:55:00Z', now, 'drive')).toBe('llegando ahora');
  });
});
