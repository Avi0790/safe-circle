// Roll call rows (migration ...000075), as the phone's lib/rollCall.ts.

export interface RollCallSummary {
  id: string
  started_by_name: string | null
  note: string | null
  created_at: string
  closed_at: string | null
  asked: number
  safe: number
  help: number
  my_answer: 'safe' | 'help' | null
  asked_me: boolean
  can_close: boolean
}

export interface RollCallPerson {
  user_id: string
  full_name: string | null
  answer: 'safe' | 'help' | null
  answered_at: string | null
  latitude: number | null
  longitude: number | null
}

export function rollCallTally(r: Pick<RollCallSummary, 'asked' | 'safe' | 'help'>) {
  return { safe: r.safe, help: r.help, waiting: Math.max(0, r.asked - r.safe - r.help) }
}
