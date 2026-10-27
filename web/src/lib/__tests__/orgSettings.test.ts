import { confirmsName, DELETE_EFFECTS } from '../orgSettings'

describe('deleting an organization (web)', () => {
  it('matches the name the way the database does', () => {
    expect(confirmsName(' riverside ', 'Riverside')).toBe(true)
    expect(confirmsName('Riversid', 'Riverside')).toBe(false)
    expect(confirmsName('', '')).toBe(false)
  })

  it('says what goes and what stays', () => {
    expect(DELETE_EFFECTS.join(' ')).toContain('shifts, timesheets, teams')
    expect(DELETE_EFFECTS.join(' ')).toContain('circles or own location history are touched')
  })
})
