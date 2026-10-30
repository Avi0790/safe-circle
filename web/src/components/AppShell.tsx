import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { overseerOrgs, type OrgMembership } from '../lib/org'
import { Dashboard } from './Dashboard'
import { OrgDashboard } from './OrgDashboard'
import { PlatformDashboard } from './PlatformDashboard'
import { chooseLanguage, language, t, type Language } from '../lib/i18n'

type View = 'work' | 'circles' | 'platform'

// Decides what a signed-in person sees. Anyone who oversees an organization
// gets a Work view beside the circle dashboard; everyone else (family
// circles, individuals, plain workers) gets exactly the dashboard they had
// before, with no extra bar. The platform owner (platform_admins, migration
// ...000066) also gets a Platform view of totals.
export function AppShell({ myUserId }: { myUserId: string }) {
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null)
  const [platformAdmin, setPlatformAdmin] = useState(false)
  const [view, setView] = useState<View | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('my_orgs').then(({ data }) => {
      if (!cancelled) setOrgs((data as OrgMembership[] | null) ?? [])
    })
    // false (or an error, on a server without it) just means no Platform tab
    supabase.rpc('is_platform_admin').then(({ data }) => {
      if (!cancelled) setPlatformAdmin(data === true)
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

  if (orgs === null) return <div className="centered">{t('Loading…')}</div>

  const overseen = overseerOrgs(orgs)
  if (overseen.length === 0 && !platformAdmin) return <Dashboard myUserId={myUserId} />

  const current: View = view ?? (overseen.length > 0 ? 'work' : 'circles')
  const tab = (v: View, label: string) => (
    <button
      className={current === v ? 'org-tab org-tab-on' : 'org-tab'}
      aria-current={current === v ? 'page' : undefined}
      onClick={() => setView(v)}
    >
      {label}
    </button>
  )

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        {t('Skip to content')}
      </a>
      <nav className="shell-bar" aria-label={t('Sections')}>
        {overseen.length > 0 && tab('work', 'Work')}
        {tab('circles', 'Circles')}
        {platformAdmin && tab('platform', 'Platform')}
        <span className="shell-spacer" />
        <select
          className="lang-select"
          aria-label={t('Language')}
          value={language()}
          onChange={(e) => chooseLanguage(e.target.value as Language)}
        >
          {/* each language named in itself, so its speakers can find it */}
          <option value="en" lang="en">
            English
          </option>
          <option value="es" lang="es">
            Español
          </option>
        </select>
        <button className="link-button" onClick={() => supabase.auth.signOut()}>
          {t('Sign out')}
        </button>
      </nav>
      <div className="shell-body" id="content" tabIndex={-1}>
        {current === 'work' && overseen.length > 0 ? (
          <OrgDashboard orgs={overseen} myUserId={myUserId} onOrgsChanged={reloadOrgs} />
        ) : current === 'platform' && platformAdmin ? (
          <PlatformDashboard />
        ) : (
          <Dashboard myUserId={myUserId} />
        )}
      </div>
    </div>
  )
}
