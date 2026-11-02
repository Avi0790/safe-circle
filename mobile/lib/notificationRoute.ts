// Where tapping a notification takes you. Each push carries a `type` (and
// usually an id) in its data, set by the database or an Edge Function; the
// screen it belongs to is decided here, in one place, so it's testable.
// Anything unknown just opens the app where it was.

export type NotificationRoute =
  | { pathname: '/' }
  | { pathname: '/work' }
  | { pathname: '/chat' }
  | { pathname: '/join-requests' }
  | { pathname: '/roll-call' | '/schedule' | '/incidents' | '/crew'; params: { orgId: string; orgName?: string } };

type Data = Record<string, unknown> | null | undefined;

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

// Family and travel alerts are about where someone is: the map.
const MAP = new Set(['sos', 'walk', 'safety_timer', 'shared_trip', 'pin', 'curfew', 'ride', 'nearby', 'arrived', 'low_battery', 'ownership', 'join_decision']);

export function routeForNotification(data: Data, orgName?: (orgId: string) => string | undefined): NotificationRoute | null {
  const type = str(data?.type);
  if (!type) return null;
  const orgId = str(data?.orgId);
  const withOrg = (pathname: '/roll-call' | '/schedule' | '/incidents' | '/crew'): NotificationRoute =>
    orgId ? { pathname, params: { orgId, ...(orgName?.(orgId) ? { orgName: orgName(orgId) } : {}) } } : { pathname: '/work' };

  if (MAP.has(type)) return { pathname: '/' };
  switch (type) {
    case 'message':
      return { pathname: '/chat' };
    case 'join_request':
      return { pathname: '/join-requests' };
    case 'roll_call':
      return { pathname: '/work' }; // the answer prompt covers whatever's open
    case 'roll_call_help':
    case 'roll_call_late':
      return withOrg('/roll-call');
    case 'schedule':
    case 'shift_request':
      return withOrg('/schedule');
    case 'incident':
      return withOrg('/incidents');
    case 'shift_weather':
      return withOrg('/crew');
    case 'checkin':
    case 'quiet_phone':
    case 'org_closed':
      return { pathname: '/work' };
    default:
      return null;
  }
}
