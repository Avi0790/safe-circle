import { reportDetails, reportsForCircle, type RoadReport } from '../roadReports'

const now = Date.parse('2026-10-19T15:00:00Z')

const report = (id: string, reporter: string, over: Partial<RoadReport> = {}): RoadReport => ({
  id,
  reporter_id: reporter,
  kind: 'crash',
  latitude: 35,
  longitude: -90,
  created_at: new Date(now - 12 * 60_000).toISOString(),
  expires_at: new Date(now + 48 * 60_000).toISOString(),
  profiles: { full_name: 'Sam' },
  ...over,
})

describe('reportsForCircle', () => {
  it("keeps the selected circle's members' reports and mine, while live", () => {
    const list = [
      report('member', 'sam'),
      report('mine', 'me'),
      report('other-circle', 'pat'),
      report('expired', 'sam', { expires_at: new Date(now - 1).toISOString() }),
    ]
    expect(reportsForCircle(list, ['sam', 'me'], 'me', now).map((r) => r.id)).toEqual(['member', 'mine'])
    expect(reportsForCircle(list, [], undefined, now)).toEqual([])
  })
})

describe('reportDetails', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now)
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('says what, who and how long', () => {
    expect(reportDetails(report('r', 'sam'), 'me', now)).toEqual({
      title: '💥 Crash reported',
      body: 'By Sam · 12m ago · clears in 48 min',
    })
    expect(reportDetails(report('r', 'me', { kind: 'speed_check' }), 'me', now).title).toBe('🚓 Speed check reported')
    expect(reportDetails(report('r', 'me'), 'me', now).body).toMatch(/^By you · /)
    expect(reportDetails(report('r', 'x', { profiles: null }), 'me', now).body).toMatch(/^By someone in your circle/)
  })
})
