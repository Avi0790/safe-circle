import { billingReturnNotice, parseSeats, priceLine } from '../billing'

describe('Stripe billing helpers', () => {
  it('says what happened when Stripe sends the owner back', () => {
    expect(billingReturnNotice('?billing=success')).toContain('Payment received')
    expect(billingReturnNotice('?billing=cancel')).toBe('Checkout canceled. Nothing was charged.')
    expect(billingReturnNotice('?billing=portal')).toContain('Back from billing')
    expect(billingReturnNotice('')).toBeNull()
    expect(billingReturnNotice('?billing=hacked')).toBeNull()
  })

  it('accepts whole seat counts from 1 to 500', () => {
    expect(parseSeats(' 5 ')).toBe(5)
    expect(parseSeats('0')).toBeNull()
    expect(parseSeats('501')).toBeNull()
    expect(parseSeats('2.5')).toBeNull()
    expect(parseSeats('abc')).toBeNull()
  })

  it('prices seats at $4 a month', () => {
    expect(priceLine(1)).toBe('1 seat · $4/month')
    expect(priceLine(5)).toBe('5 seats · $20/month')
  })
})
