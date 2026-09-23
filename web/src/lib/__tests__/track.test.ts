import { parseTrackToken } from '../track'

describe('parseTrackToken', () => {
  const token = 'a'.repeat(48)

  it('extracts a token from a track path', () => {
    expect(parseTrackToken(`/track/${token}`)).toBe(token)
    expect(parseTrackToken(`/track/${token}/`)).toBe(token)
  })

  it('ignores every other path', () => {
    expect(parseTrackToken('/')).toBeNull()
    expect(parseTrackToken('/track/')).toBeNull()
    expect(parseTrackToken('/track/short')).toBeNull()
    expect(parseTrackToken(`/other/${token}`)).toBeNull()
    expect(parseTrackToken(`/track/${token}/extra`)).toBeNull()
    expect(parseTrackToken(`/track/${'z'.repeat(48)}`)).toBeNull()
  })
})
