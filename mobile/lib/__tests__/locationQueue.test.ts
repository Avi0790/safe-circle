import { enqueue, loadQueue, clearQueue, saveQueue, type QueuedPing } from '../locationQueue';

// The offline queue is the part of AJ's layer that's easiest to get wrong
// silently (a bug here just means pings quietly vanish), so it's worth
// covering directly rather than only through the background task.

const samplePing: QueuedPing = {
  latitude: 37.7749,
  longitude: -122.4194,
  accuracy: 5,
  battery_level: 0.8,
  recorded_at: '2026-01-01T00:00:00.000Z',
};

describe('locationQueue', () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it('starts empty', async () => {
    expect(await loadQueue()).toEqual([]);
  });

  it('persists an enqueued ping and returns it from loadQueue', async () => {
    await enqueue(samplePing);
    expect(await loadQueue()).toEqual([samplePing]);
  });

  it('appends rather than overwrites on repeated enqueue calls', async () => {
    const second: QueuedPing = { ...samplePing, latitude: 10, longitude: 10 };
    await enqueue(samplePing);
    await enqueue(second);
    expect(await loadQueue()).toEqual([samplePing, second]);
  });

  it('clearQueue empties the queue', async () => {
    await enqueue(samplePing);
    await clearQueue();
    expect(await loadQueue()).toEqual([]);
  });

  it('saveQueue replaces the whole queue (used to put a failed batch back)', async () => {
    await enqueue(samplePing);
    const replacement = [samplePing, samplePing];
    await saveQueue(replacement);
    expect(await loadQueue()).toEqual(replacement);
  });
});
