import type { SosEvent } from './types'

// Rows from org_sos_details (migration ...000055).
export interface SosDetailRow {
  event_id: number
  kind: 'sender' | 'ack'
  user_id: string
  full_name: string
}

// Profiles are only readable between circle-mates, so for an SOS an
// organization's overseer is watching, the sender's and acknowledgers' names
// come back empty from the normal query. Fill only the blanks from the
// minimal org_sos_details lookup.
export function fillSosNames(events: SosEvent[], rows: SosDetailRow[]): SosEvent[] {
  if (rows.length === 0) return events
  return events.map((event) => {
    const sender = rows.find((r) => r.event_id === event.id && r.kind === 'sender')
    return {
      ...event,
      profiles: event.profiles ?? (sender ? { full_name: sender.full_name } : null),
      sos_acknowledgements: event.sos_acknowledgements.map((ack) => {
        if (ack.profiles) return ack
        const match = rows.find((r) => r.event_id === event.id && r.kind === 'ack' && r.user_id === ack.user_id)
        return match ? { ...ack, profiles: { full_name: match.full_name } } : ack
      }),
    }
  })
}

export function eventsMissingNames(events: SosEvent[]): number[] {
  return events
    .filter((e) => !e.profiles || e.sos_acknowledgements.some((a) => !a.profiles))
    .map((e) => e.id)
}
