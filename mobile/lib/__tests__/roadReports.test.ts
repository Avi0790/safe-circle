import fixture from './fixtures/osrm-jonesboro.json';
import { prepareRoute } from '../navigation';
import { parseOsrmRoute } from '../routing';
import { reportDetails, reportIncident, reportsForCircle, upcomingReport, type RoadReport } from '../roadReports';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn() } }));

// A real route; reports are placed on (or beside) it by distance along it.
const prepared = prepareRoute(parseOsrmRoute(fixture));
const now = Date.parse('2026-10-19T15:00:00Z');

function pointAt(alongM: number) {
  const { cum } = prepared;
  const i = cum.findIndex((c) => c >= alongM);
  return prepared.route.coords[Math.max(0, i)];
}

const report = (id: string, alongM: number, over: Partial<RoadReport> = {}): RoadReport => ({
  id,
  reporter_id: 'them',
  kind: 'crash',
  ...pointAt(alongM),
  created_at: new Date(now - 60_000).toISOString(),
  expires_at: new Date(now + 3_600_000).toISOString(),
  ...over,
});

describe('upcomingReport', () => {
  const at = 2000; // metres into the route

  it('finds a report on the road ahead and says how far', () => {
    const hit = upcomingReport(prepared, at, [report('r', at + 500)], new Set(), now)!;
    expect(hit.report.id).toBe('r');
    expect(hit.aheadM).toBeGreaterThan(300);
    expect(hit.aheadM).toBeLessThan(700);
  });

  it('ignores one too far ahead, one behind you, one off the road, one expired, one already announced', () => {
    const far = report('far', at + 2000);
    const behind = report('behind', at - 400);
    const off = report('off', at + 400);
    // ~1.1 km to the side: farther than any of the next 800 m of road can be
    off.latitude += 0.01;
    const expired = report('expired', at + 300, { expires_at: new Date(now - 1).toISOString() });
    const said = report('said', at + 300);
    expect(upcomingReport(prepared, at, [far, behind, off, expired, said], new Set(['said']), now)).toBeNull();
  });

  it('picks the nearest when there are several', () => {
    const hit = upcomingReport(prepared, at, [report('later', at + 700), report('sooner', at + 200)], new Set(), now)!;
    expect(hit.report.id).toBe('sooner');
  });
});

describe('reportIncident', () => {
  it('sends the kind and where you are, nothing else', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'rep-1', error: null });
    expect(await reportIncident('speed_check', { latitude: 35.1, longitude: -90.2 })).toEqual({ ok: true, id: 'rep-1' });
    expect((supabase.rpc as jest.Mock).mock.calls[0]).toEqual([
      'report_road_incident',
      { p_kind: 'speed_check', p_latitude: 35.1, p_longitude: -90.2 },
    ]);
  });

  it("passes on the server's refusal", async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: "That's a lot of reports" } });
    expect(await reportIncident('crash', { latitude: 35, longitude: -90 })).toEqual({ ok: false, error: "That's a lot of reports" });
  });
});

describe('reports on the Map tab', () => {
  const base = (id: string, reporter: string, over: Partial<RoadReport> = {}): RoadReport => ({
    id, reporter_id: reporter, kind: 'crash', latitude: 35, longitude: -90,
    created_at: new Date(now - 12 * 60_000).toISOString(), expires_at: new Date(now + 48 * 60_000).toISOString(),
    profiles: { full_name: 'Sam' }, ...over,
  });

  it("shows this circle's members' reports and mine, still live; not other circles' or expired ones", () => {
    const list = [
      base('member', 'sam'),
      base('mine', 'me'),
      base('other-circle', 'pat'),
      base('expired', 'sam', { expires_at: new Date(now - 1).toISOString() }),
    ];
    expect(reportsForCircle(list, ['sam', 'me'], 'me', now).map((r) => r.id)).toEqual(['member', 'mine']);
    expect(reportsForCircle(list, ['pat'], 'me', now).map((r) => r.id)).toEqual(['mine', 'other-circle']);
  });

  it('says what, who and how long', () => {
    jest.useFakeTimers().setSystemTime(now);
    const d = reportDetails(base('r', 'sam'), 'me', now);
    expect(d.title).toBe('💥 Crash reported');
    expect(d.body).toBe('By Sam · 12m ago · clears in 48 min');
    expect(reportDetails(base('r', 'me', { kind: 'closure' }), 'me', now)).toMatchObject({ title: '🚧 Road closed reported' });
    expect(reportDetails(base('r', 'me'), 'me', now).body).toMatch(/^By you · /);
    expect(reportDetails(base('r', 'x', { profiles: null }), 'me', now).body).toMatch(/^By someone in your circle · /);
    jest.useRealTimers();
  });
});
