jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { buildLocationReportHtml } from '../locationReport';
import type { Trip } from '../trips';

const trip: Trip = {
  tripId: 1,
  startedAt: '2026-09-30T09:00:00Z',
  endedAt: '2026-09-30T09:08:00Z',
  durationSeconds: 480,
  distanceMeters: 1825.2,
  maxSpeedMps: 21.5,
  avgSpeedMps: 18.0,
  startLatitude: 35.1,
  startLongitude: -90.0,
  endLatitude: 35.2,
  endLongitude: -90.1,
};

describe('buildLocationReportHtml', () => {
  it('embeds the pings as a points array for the map', () => {
    const html = buildLocationReportHtml('Surenda BK', [
      { latitude: 35.1, longitude: -90.0, speed: 10, recorded_at: '2026-09-30T09:00:00Z' },
      { latitude: 35.2, longitude: -90.1, speed: 20, recorded_at: '2026-09-30T09:08:00Z' },
    ], [trip]);
    expect(html).toContain('[35.2,-90.1]');
    expect(html).toContain('[35.1,-90]');
  });

  it('renders a trip row with duration, distance, and top speed', () => {
    const html = buildLocationReportHtml('Surenda BK', [], [trip]);
    expect(html).toContain('8 min');
    expect(html).toContain('1.1 mi');
    expect(html).toContain('48 mph');
  });

  it('shows a fallback message when there are no trips', () => {
    const html = buildLocationReportHtml('Surenda BK', [], []);
    expect(html).toContain('No trips in the last 30 days.');
  });

  it('escapes HTML-unsafe characters in the name', () => {
    const html = buildLocationReportHtml('<script>alert(1)</script>', [], []);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
