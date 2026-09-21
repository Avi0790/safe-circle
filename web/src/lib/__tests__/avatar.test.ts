import { getAvatarColor, getInitials, isSafeAvatarUrl } from '../avatar'

describe('getInitials', () => {
  it('takes first + last initial for a full name', () => {
    expect(getInitials('Alex Kim')).toBe('AK')
    expect(getInitials('Mary Jane Watson')).toBe('MW')
  })

  it('takes the first two letters of a single name', () => {
    expect(getInitials('Cher')).toBe('CH')
  })

  it('handles extra whitespace', () => {
    expect(getInitials('  Alex   Kim  ')).toBe('AK')
  })

  it('falls back to "?" for an empty name', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials('   ')).toBe('?')
  })
})

describe('getAvatarColor', () => {
  it('is deterministic for the same id', () => {
    expect(getAvatarColor('user-123')).toBe(getAvatarColor('user-123'))
  })

  it('returns a hex color', () => {
    expect(getAvatarColor('user-123')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is not the same for every id (spreads across the palette)', () => {
    const colorsSeen = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => getAvatarColor(id)),
    )
    expect(colorsSeen.size).toBeGreaterThan(1)
  })
})

describe('isSafeAvatarUrl', () => {
  it('accepts http(s) URLs only', () => {
    expect(isSafeAvatarUrl('https://x.co/a.jpg')).toBe(true)
    expect(isSafeAvatarUrl('http://127.0.0.1:54321/a.jpg')).toBe(true)
    expect(isSafeAvatarUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeAvatarUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isSafeAvatarUrl(null)).toBe(false)
  })
})
