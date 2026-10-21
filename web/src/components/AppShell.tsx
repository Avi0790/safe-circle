import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { overseerOrgs, type OrgMembership } from '../lib/org'
import { Dashboard } from './Dashboard'
import { OrgDashboard } from './OrgDashboard'

type View = 'work' | 'circles'

// Decides what a signed-in person sees. Anyone who oversees an organization
// gets a Work view beside the circle dashboard; everyone else (family
// circles, individuals, plain workers) gets exactly the dashboard they had
// before, with no extra bar.
export function AppShell({ myUserId }: { myUserId: string }) {
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null)
  const [view, setView] = useState<View>('work')

  useEffect(() => {
    let cancelled = false
    supabase.rpc('my_orgs').then(({ data }) => {
      if (!cancelled) setOrgs((data as OrgMembership[] | null) ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  // after a plan change, so the badge and seat counts are current
  async function reloadOrgs() {
    const { data } = await supabase.rpc('my_orgs')
    setOrgs((data as OrgMembership[] | null) ?? [])
  }

  if (orgs === null) return <div className="centered">Loading…</div>

  const overseen = overseerOrgs(orgs)
  if (overseen.length === 0) return <Dashboard myUserId={myUserId} />

  return (
    <div className="shell">
      <nav className="shell-bar">
        <button className={view === 'work' ? 'org-tab org-tab-on' : 'org-tab'} onClick={() => setView('work')}>
          Work
        </button>
        <button className={view === 'circles' ? 'org-tab org-tab-on' : 'org-tab'} onClick={() => setView('circles')}>
          Circles
        </button>
        <span className="shell-spacer" />
        <button className="link-button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </nav>
      <div className="shell-body">
        {view === 'work' ? <OrgDashboard orgs={overseen} myUserId={myUserId} onOrgsChanged={reloadOrgs} /> : <Dashboard myUserId={myUserId} />}
      </div>
    </div>
  )
}
