import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDestination,
  clearDestinations,
  loadDestinations,
  MAX_NAME_LENGTH,
  MAX_SAVED_DESTINATIONS,
  parseDestinations,
  removeDestination,
  savedAt,
  sortDestinations,
  storeDestinations,
  type SavedDestination,
} from '../savedDestinations';

const d = (id: string, name: string, latitude = 35, longitude = -90): SavedDestination => ({ id, name, latitude, longitude });

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('addDestination', () => {
  it('adds a place and trims its name', () => {
    const r = addDestination([], { name: '  Gym ', latitude: 35, longitude: -90 }, 'a');
    expect(r).toEqual({ ok: true, list: [d('a', 'Gym')] });
  });

  it('refuses an empty name', () => {
    expect(addDestination([], { name: '   ', latitude: 35, longitude: -90 }, 'a')).toEqual({ ok: false, reason: 'name' });
  });

  it('caps the name length', () => {
    const r = addDestination([], { name: 'x'.repeat(100), latitude: 35, longitude: -90 }, 'a');
    expect(r.ok && r.list[0].name.length).toBe(MAX_NAME_LENGTH);
  });

  it('moves an existing name to the new spot, whatever the case (changing Home)', () => {
    const r = addDestination([d('a', 'Home', 35, -90)], { name: 'home', latitude: 36, longitude: -91 }, 'b');
    expect(r).toEqual({ ok: true, list: [{ id: 'b', name: 'home', latitude: 36, longitude: -91 }] });
  });

  it('renames instead of doubling when the same spot is saved under another name', () => {
    const r = addDestination([d('a', 'Mom', 35, -90)], { name: 'Home', latitude: 35.0001, longitude: -90.0001 }, 'b');
    expect(r.ok && r.list.map((x) => x.name)).toEqual(['Home']);
  });

  it('keeps places that are far apart', () => {
    const r = addDestination([d('a', 'Gym', 35, -90)], { name: 'Home', latitude: 36, longitude: -91 }, 'b');
    expect(r.ok && r.list.map((x) => x.name)).toEqual(['Home', 'Gym']);
  });

  it('refuses a new place when full, but still lets a name be moved', () => {
    const full = Array.from({ length: MAX_SAVED_DESTINATIONS }, (_, i) => d(`i${i}`, `Place ${i}`, 10 + i, 10 + i));
    expect(addDestination(full, { name: 'New', latitude: 1, longitude: 1 }, 'n')).toEqual({ ok: false, reason: 'full' });
    expect(addDestination(full, { name: 'Place 3', latitude: 1, longitude: 1 }, 'n').ok).toBe(true);
  });
});

describe('sorting, removing and finding', () => {
  it('lists Home then Work, then the rest alphabetically', () => {
    const sorted = sortDestinations([d('1', 'Zoo'), d('2', 'work'), d('3', 'Cafe'), d('4', 'HOME')]);
    expect(sorted.map((x) => x.name)).toEqual(['HOME', 'work', 'Cafe', 'Zoo']);
  });

  it('removes by id', () => {
    expect(removeDestination([d('1', 'A'), d('2', 'B')], '1').map((x) => x.id)).toEqual(['2']);
  });

  it('finds the saved place at a spot, within about 30 m', () => {
    const list = [d('1', 'Home', 35, -90)];
    expect(savedAt(list, { latitude: 35.0001, longitude: -90 })?.name).toBe('Home');
    expect(savedAt(list, { latitude: 35.01, longitude: -90 })).toBeUndefined();
  });
});

describe('parseDestinations', () => {
  it('survives garbage', () => {
    expect(parseDestinations(null)).toEqual([]);
    expect(parseDestinations('not json')).toEqual([]);
    expect(parseDestinations('{"a":1}')).toEqual([]);
  });

  it('keeps only valid entries', () => {
    const raw = JSON.stringify([d('1', 'Ok'), { id: '2', name: '', latitude: 1, longitude: 1 }, { id: '3', name: 'Bad', latitude: 999, longitude: 1 }, null, 'x']);
    expect(parseDestinations(raw).map((x) => x.id)).toEqual(['1']);
  });
});

describe('storage', () => {
  it('round-trips, per account', async () => {
    expect(await storeDestinations('u1', [d('1', 'Home')])).toBe(true);
    expect((await loadDestinations('u1')).map((x) => x.name)).toEqual(['Home']);
    expect(await loadDestinations('u2')).toEqual([]);
  });

  it('clears one account without touching another', async () => {
    await storeDestinations('u1', [d('1', 'Home')]);
    await storeDestinations('u2', [d('2', 'Work')]);
    await clearDestinations('u1');
    expect(await loadDestinations('u1')).toEqual([]);
    expect((await loadDestinations('u2')).map((x) => x.name)).toEqual(['Work']);
  });

  it('reports a failed write instead of pretending', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    expect(await storeDestinations('u1', [d('1', 'Home')])).toBe(false);
    spy.mockRestore();
  });
});
