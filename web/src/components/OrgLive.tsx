import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import {
  crewSummary,
  hasPosition,
  splitCrew,
  workerFlags,
  type CrewShift,
  type LiveWorker,
  type RosterMember,
  type TrackPoint,
} from '../lib/crew'
import { formatClockTime, timeAgo } from '../lib/format'
import { OrgMap } from './OrgMap'

const POLL_MS = 30_000

// The live crew view. Polls instead of subscribing: every look at a worker
// goes through org_live_roster / org_worker_track, which apply the shift
// window and write the audit log the worker can read — a realtime stream of
// the locations table would bypass both, and managers deliberately have no
// direct read access to it.
export function OrgLive({ org }: { org: OrgMembership }) {
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [live, setLive] = useState<LiveWorker[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [track, setTrack] = useState<TrackPoint[]>([])
  const [shifts, setShifts] = useState<CrewShift[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    const [rosterRes, liveRes] = await Promise.all([
      supabase.rpc('org_roster', { p_org: org.org_id }),
      supabase.rpc('org_live_roster', { p_org: org.org_id }),
    ])
    const failure = rosterRes.error ?? liveRes.error
    if (failure) {
      setError(failure.message)
    } else {
      setError(null)
      setRoster((rosterRes.data as RosterMember[]) ?? [])
      setLive((liveRes.data as LiveWorker[]) ?? [])
    }
    setLoaded(true)
  }, [org.org_id])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  async function select(userId: string | null) {
    setSelectedId(userId)
    setTrack([])
    setShifts([])
    if (!userId) return
    setDetailLoading(true)
    const to = new Date()
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000)
    const [trackRes, shiftRes] = await Promise.all([
      supabase.rpc('org_worker_track', {
        p_org: org.org_id,
        p_user: userId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      }),
      supabase.rpc('org_shifts', { p_org: org.org_id, p_days: 7, p_limit: 200 }),
    ])
    setDetailLoading(false)
    if (trackRes.error || shiftRes.error) {
      setError((trackRes.error ?? shiftRes.error)!.message)
      return
    }
    setTrack((trackRes.data as TrackPoint[]) ?? [])
    setShifts(((shiftRes.data as CrewShift[]) ?? []).filter((s) => s.user_id === userId))
  }

  const split = splitCrew(roster, live)
  const selected = live.find((w) => w.user_id === selectedId) ?? null

  return (
    <div className="org-live">
      <aside className="org-side">
        <div className="org-side-head">
          <h2>{loaded ? crewSummary(split) : 'Loading…'}</h2>
          <p className="org-note">
            Workers can see when you look at their location, in their Work tab. You only ever see
            people while they're clocked in.
          </p>
          {error && <p className="org-error">{error}</p>}
        </div>

        {selected && (
          <div className="org-detail">
            <button className="link-button" onClick={() => select(null)}>
              ← All crew
            </button>
            <h3>{selected.full_name}</h3>
            <p className="org-note">
              Last 24 hours, and only time spent on shift. Nothing before they clocked in or after
              they clocked out is ever shown. {selected.full_name} can see that you looked.
            </p>
            {detailLoading && <p className="org-note">Loading…</p>}
            {!detailLoading && track.length === 0 && <p className="org-note">No on-shift positions in the last 24 hours.</p>}
            {track.length > 0 && <p>{track.length} positions recorded on shift.</p>}
            <h4>Recent shifts</h4>
            {!detailLoading && shifts.length === 0 && <p className="org-note">No shifts in the last 7 days.</p>}
            {shifts.map((s) => (
              <p key={s.shift_id} className="org-shift">
                {new Date(s.clocked_in_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}
                {formatClockTime(s.clocked_in_at)} – {s.is_open ? 'now' : formatClockTime(s.ended_at)}
                {s.is_open ? ' (on shift)' : ''}
              </p>
            ))}
          </div>
        )}

        {!selected && (
          <>
            {split.onShift.length > 0 && <h3 className="org-section">On shift</h3>}
            {split.onShift.map((w) => {
              const f = workerFlags(w)
              return (
                <div
                  key={w.user_id}
                  className="org-card org-card-click"
                  role="button"
                  tabIndex={0}
                  onClick={() => select(w.user_id)}
                  onKeyDown={(e) => e.key === 'Enter' && select(w.user_id)}
                >
                  <strong>{w.full_name}</strong>
                  <span className="org-note">
                    On since {formatClockTime(w.clocked_in_at)}
                    {w.team_names ? ` · ${w.team_names}` : ''}
                  </span>
                  <span className={f.stale || f.noFix ? 'org-warn' : 'org-note'}>
                    {f.noFix
                      ? 'No location yet'
                      : `Last heard from ${timeAgo(w.recorded_at as string)}${f.stale ? ' — may be offline' : ''}`}
                    {f.driving && f.mph != null ? ` · 🚗 ${Math.round(f.mph)} mph` : ''}
                    {f.lowBattery ? ' · 🪫 low battery' : ''}
                  </span>
                </div>
              )
            })}

            {split.offShift.length > 0 && <h3 className="org-section">Off shift</h3>}
            {split.offShift.map((m) => (
              <div key={m.user_id} className="org-card">
                <strong>{m.full_name}</strong>
                <span className="org-note">Off shift — no location is shown.</span>
              </div>
            ))}

            {split.pending.length > 0 && <h3 className="org-section">Waiting to accept</h3>}
            {split.pending.map((m) => (
              <div key={m.user_id} className="org-card">
                <strong>{m.full_name}</strong>
                <span className="org-note">Joined with your code but hasn't accepted the disclosure yet.</span>
              </div>
            ))}

            {loaded && !error && roster.filter((m) => m.role === 'worker').length === 0 && (
              <p className="org-note">
                No crew members to show yet. Admins can invite people from People &amp; teams; managers
                see the workers on teams they lead.
              </p>
            )}
          </>
        )}
      </aside>

      <div className="org-map-pane">
        {live.some(hasPosition) || track.length > 0 ? (
          <OrgMap workers={live} selectedId={selectedId} track={track} onSelect={select} />
        ) : (
          <div className="org-map-empty">The map appears once someone on shift has a location.</div>
        )}
      </div>
    </div>
  )
}
