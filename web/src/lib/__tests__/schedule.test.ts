import { byDay, dateInput, plannedByWorker, planVsActual, requestWhen, shiftFromInputs, statusInfo, type ScheduleRow } from '../schedule'

const now = Date.parse('2026-11-02T12:00:00Z')
const at = (h: number) => new Date(now + h * 3_600_000).toISOString()
const row = (over: Partial<ScheduleRow>): ScheduleRow => ({
  id: 's', user_id: 'w1', worker_name: 'Wendy', starts_at: at(-10), ends_at: at(-2), job_site: null, note: null,
  clocked_in_at: null, clocked_out_at: null, status: 'upcoming', ...over,
})

describe('schedule', () => {
  it('adds planned and worked hours and counts late and missed', () => {
    const totals = planVsActual(
      [
        row({ status: 'worked', clocked_in_at: at(-10), clocked_out_at: at(-2) }),
        row({ status: 'late', clocked_in_at: at(-9.5), clocked_out_at: at(-2) }),
        row({ status: 'missed' }),
      ],
      now,
    )
    expect(totals).toEqual({ plannedMinutes: 1440, workedMinutes: 930, late: 1, missed: 1, shifts: 3 })
  })

  it('totals planned minutes per worker', () => {
    const m = plannedByWorker([row({}), row({ user_id: 'w2' }), row({ starts_at: at(20), ends_at: at(24) })])
    expect(m.get('w1')).toBe(720)
    expect(m.get('w2')).toBe(480)
  })

  it('groups by the day a shift starts on, in order', () => {
    const groups = byDay([row({ id: 'b', starts_at: at(30), ends_at: at(38) }), row({ id: 'a' })])
    expect(groups.map((g) => g.rows[0].id)).toEqual(['a', 'b'])
  })

  it('reads the form inputs as local time and rejects junk', () => {
    const s = shiftFromInputs('2026-11-03', '07:30', 8)!
    expect(s.starts.getHours()).toBe(7)
    expect(s.ends.getTime() - s.starts.getTime()).toBe(8 * 3_600_000)
    expect(dateInput(s.starts)).toBe('2026-11-03')
    expect(shiftFromInputs('', '07:30', 8)).toBeNull()
  })

  it('treats an unknown status as upcoming', () => {
    expect(statusInfo('missed').tone).toBe('danger')
    expect(statusInfo('??').label).toBe('Upcoming')
  })
})

describe('requestWhen', () => {
  const day = (iso: string) => new Date(iso).toDateString().slice(0, 10)
  const clock = (iso: string) => `${new Date(iso).getHours()}h`
  it('says the last day off, and a shift by its hours', () => {
    const from = new Date(2026, 10, 3)
    const to = new Date(2026, 10, 6)
    expect(requestWhen({ kind: 'time_off', starts_at: from.toISOString(), ends_at: to.toISOString() }, day, clock)).toBe('Tue Nov 03 – Thu Nov 05')
    const s = new Date(2026, 10, 3, 7)
    const e = new Date(2026, 10, 3, 15)
    expect(requestWhen({ kind: 'drop', starts_at: s.toISOString(), ends_at: e.toISOString() }, day, clock)).toBe('Tue Nov 03, 7h – 15h')
  })
})
