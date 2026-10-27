import { money } from './platform'

// Real billing through Stripe (migration ...000069, Edge Functions `billing`
// and `stripe-webhook`). Pure helpers; the Plan tab does the calls.

export const SEAT_PRICE_CENTS = 400

// Stripe sends the owner back to /?billing=…; what to tell them.
export function billingReturnNotice(search: string): string | null {
  switch (new URLSearchParams(search).get('billing')) {
    case 'success':
      return 'Payment received. Your plan updates as soon as Stripe confirms it, usually within a few seconds.'
    case 'cancel':
      return 'Checkout canceled. Nothing was charged.'
    case 'portal':
      return 'Back from billing. Any changes show here once Stripe confirms them.'
    default:
      return null
  }
}

// A seat count the owner typed: whole, 1 to 500, or null.
export function parseSeats(input: string): number | null {
  const n = Number(input.trim())
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : null
}

// "5 seats · $20/month"
export function priceLine(seats: number): string {
  return `${seats} ${seats === 1 ? 'seat' : 'seats'} · ${money(seats * SEAT_PRICE_CENTS)}/month`
}
