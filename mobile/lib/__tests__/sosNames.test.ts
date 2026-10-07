import { eventsMissingNames, fillSosNames, type SosDetailRow } from '../sosNames';
import type { SosEvent } from '../types';

const event = (id: number, overrides: Partial<SosEvent> = {}): SosEvent => ({
  id,
  user_id: 'w',
  latitude: 1,
  longitude: 1,
  message: null,
  created_at: '2026-10-09T00:00:00Z',
  resolved_at: null,
  resolved_by: null,
  profiles: null,
  sos_acknowledgements: [],
  ...overrides,
});

describe('fillSosNames', () => {
  it('fills a missing sender and acknowledger name from the lookup', () => {
    const rows: SosDetailRow[] = [
      { event_id: 1, kind: 'sender', user_id: 'w', full_name: 'Wendy' },
      { event_id: 1, kind: 'ack', user_id: 'm', full_name: 'Max' },
    ];
    const [e] = fillSosNames(
      [event(1, { sos_acknowledgements: [{ user_id: 'm', created_at: 'x', profiles: null }] })],
      rows,
    );
    expect(e.profiles).toEqual({ full_name: 'Wendy' });
    expect(e.sos_acknowledgements[0].profiles).toEqual({ full_name: 'Max' });
  });

  it('never overwrites a name the normal query already returned', () => {
    const [e] = fillSosNames(
      [event(1, { profiles: { full_name: 'Real Name' } })],
      [{ event_id: 1, kind: 'sender', user_id: 'w', full_name: 'Other' }],
    );
    expect(e.profiles).toEqual({ full_name: 'Real Name' });
  });

  it("does not attach one event's names to another", () => {
    const [a, b] = fillSosNames(
      [event(1), event(2)],
      [{ event_id: 2, kind: 'sender', user_id: 'w', full_name: 'Only Two' }],
    );
    expect(a.profiles).toBeNull();
    expect(b.profiles).toEqual({ full_name: 'Only Two' });
  });

  it('returns the same events when there is nothing to fill', () => {
    const events = [event(1)];
    expect(fillSosNames(events, [])).toBe(events);
  });
});

describe('eventsMissingNames', () => {
  it('lists only events with a missing sender or acknowledger name', () => {
    const events = [
      event(1, { profiles: { full_name: 'A' } }),
      event(2),
      event(3, { profiles: { full_name: 'C' }, sos_acknowledgements: [{ user_id: 'm', created_at: 'x', profiles: null }] }),
    ];
    expect(eventsMissingNames(events)).toEqual([2, 3]);
  });
});
