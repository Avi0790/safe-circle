import type { CrewShift } from '../crew'
import {
  buildTimesheet,
  daysToFetch,
  hours,
  timesheetCsv,
  timesheetFilename,
  weekLabel,
  weekStart,
} from '../timesheet'

// Local times, so the tests hold in any time zone.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m); // October 2026
const shift = (id: number, user: string, name: string, from: Date, to: Date, isOpen = false): CrewShift => ({
  shift_id: id, user_id: user, full_name: name, clocked_in_at: from.toISOString(), ended_at: to.toISOString(), is_open: isOpen,
})

const MON = weekStart(at(21, 15)); // Wed Oct 21 -> Mon Oct 19

describe('weeks', () => {
  it('start on Monday at local midnight', () => {
    expect(MON).toEqual(at(19, 0))
    expect(weekStart(at(19, 0))).toEqual(at(19, 0)); // Monday itself
    expect(weekStart(at(25, 23, 59))).toEqual(at(19, 0)); // Sunday night
    expect(weekStart(at(21, 15), 1)).toEqual(at(12, 0)); // last week
    expect(weekLabel({ weekStart: MON })).toBe('Oct 19 – Oct 25, 2026')
  })

  it('look back far enough for a shift that began the night before', () => {
    expect(daysToFetch(MON, at(21, 15))).toBe(5)
    expect(daysToFetch(weekStart(at(21, 15), 20), at(21, 15))).toBe(90); // org_shifts' limit
  })
})

describe('buildTimesheet', () => {
  const shifts = [
    shift(1, 'w1', 'Sam Field', at(19, 8), at(19, 16, 30)), // Mon 8.5 h
    shift(2, 'w1', 'Sam Field', at(20, 22), at(21, 6)), // Tue 22:00 -> Wed 06:00, split
    shift(3, 'w2', 'Ana Crew', at(21, 9), at(21, 15), true), // on shift now
    shift(4, 'w2', 'Ana Crew', at(18, 20), at(19, 2)), // Sunday night before: only 2 h this week
    shift(5, 'w3', 'Old Week', at(12, 8), at(12, 16)), // last week: not here
  ]
  const sheet = buildTimesheet(shifts, MON)

  it('totals each worker, alphabetically, and leaves out other weeks', () => {
    expect(sheet.rows.map((r) => [r.name, hours(r.totalMinutes)])).toEqual([
      ['Ana Crew', '8.00'],
      ['Sam Field', '16.50'],
    ])
    expect(hours(sheet.totalMinutes)).toBe('24.50')
  })

  it('splits overnight shifts at midnight, and across the week boundary', () => {
    const sam = sheet.rows.find((r) => r.userId === 'w1')!
    expect(sam.days.map(hours)).toEqual(['8.50', '2.00', '6.00', '0.00', '0.00', '0.00', '0.00'])
    const ana = sheet.rows.find((r) => r.userId === 'w2')!
    expect(ana.days.map(hours)).toEqual(['2.00', '0.00', '6.00', '0.00', '0.00', '0.00', '0.00'])
    expect(ana.shifts[0].start).toEqual(at(19, 0)); // clipped to Monday midnight
  })

  it('marks someone on shift now', () => {
    expect(sheet.rows.map((r) => r.onShift)).toEqual([true, false])
  })

  it('is empty for a week with no shifts', () => {
    expect(buildTimesheet([], MON)).toMatchObject({ rows: [], totalMinutes: 0 })
  })
})

describe('the CSV', () => {
  it('has a row per shift, a total per worker and overall', () => {
    const csv = timesheetCsv(buildTimesheet([
      shift(1, 'w1', 'Sam Field', at(19, 8), at(19, 16, 30)),
      shift(2, 'w1', 'Sam Field', at(20, 22), at(21, 6)),
      shift(3, 'w2', 'Ana Crew', at(21, 9), at(21, 15), true),
    ], MON), 'Riverside')
    expect(csv.split('\n')).toEqual([
      'Timesheet: Riverside,"Oct 19 – Oct 25, 2026"',
      'Worker,Date,Clocked in,Clocked out,Hours',
      'Ana Crew,2026-10-21,09:00,On shift,6.00',
      'Ana Crew,Total,,,6.00',
      'Sam Field,2026-10-19,08:00,16:30,8.50',
      'Sam Field,2026-10-20,22:00,06:00,8.00',
      'Sam Field,Total,,,16.50',
      'All workers,Total,,,22.50',
      '',
    ])
  })

  it('quotes names with commas or quotes, and defuses spreadsheet formulas', () => {
    const csv = timesheetCsv(buildTimesheet([
      shift(1, 'a', 'Lee, "Jr"', at(19, 8), at(19, 9)),
      shift(2, 'b', '=HYPERLINK("x")', at(19, 8), at(19, 9)),
    ], MON), 'Crew')
    expect(csv).toContain('"Lee, ""Jr""",2026-10-19')
    expect(csv).toContain(`"'=HYPERLINK(""x"")",2026-10-19`)
    expect(csv).not.toMatch(/^=/m)
  })

  it('names the file after the organization and week', () => {
    expect(timesheetFilename(buildTimesheet([], MON), 'Riverside Utilities!')).toBe('timesheet-riverside-utilities-2026-10-19.csv')
    expect(timesheetFilename(buildTimesheet([], MON), '!!!')).toBe('timesheet-organization-2026-10-19.csv')
  })
})
