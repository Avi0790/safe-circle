import { routeForNotification } from '../notificationRoute';

const names = (id: string) => (id === 'o1' ? 'Demo Crew' : undefined);

describe('where a tapped notification goes', () => {
  it('family and travel alerts open the map', () => {
    for (const type of ['sos', 'walk', 'safety_timer', 'shared_trip', 'pin', 'curfew', 'arrived', 'low_battery']) {
      expect(routeForNotification({ type })).toEqual({ pathname: '/' });
    }
  });

  it('a call for help in a roll call opens that roll call', () => {
    expect(routeForNotification({ type: 'roll_call_help', orgId: 'o1', rollCallId: 'r' }, names)).toEqual({
      pathname: '/roll-call',
      params: { orgId: 'o1', orgName: 'Demo Crew' },
    });
  });

  it('schedule, requests, incidents and weather open their screens', () => {
    expect(routeForNotification({ type: 'shift_request', orgId: 'o2' }, names)).toEqual({ pathname: '/schedule', params: { orgId: 'o2' } });
    expect(routeForNotification({ type: 'schedule', orgId: 'o1' }, names)?.pathname).toBe('/schedule');
    expect(routeForNotification({ type: 'incident', orgId: 'o1' })?.pathname).toBe('/incidents');
    expect(routeForNotification({ type: 'shift_weather', orgId: 'o1' })?.pathname).toBe('/crew');
  });

  it('work alerts without an organization fall back to the Work tab', () => {
    expect(routeForNotification({ type: 'incident' })).toEqual({ pathname: '/work' });
    expect(routeForNotification({ type: 'quiet_phone', shiftId: 4 })).toEqual({ pathname: '/work' });
    expect(routeForNotification({ type: 'roll_call', orgId: 'o1' })).toEqual({ pathname: '/work' });
  });

  it('chat and join requests', () => {
    expect(routeForNotification({ type: 'message' })).toEqual({ pathname: '/chat' });
    expect(routeForNotification({ type: 'join_request', circleId: 'c' })).toEqual({ pathname: '/join-requests' });
  });

  it('anything unknown stays put', () => {
    expect(routeForNotification({ type: 'something_new' })).toBeNull();
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification(null)).toBeNull();
  });
});
