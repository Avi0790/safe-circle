import { t } from '../lib/i18n'
import { POLICY, POLICY_FILL, POLICY_UPDATED } from '../lib/privacyPolicy'

// The privacy policy at /privacy: no account needed, so it's decided in
// App.tsx before any sign-in logic, like a guest tracking link.
export function PrivacyPolicy() {
  return (
    <main className="policy" id="content">
      <a className="policy-back" href="/">
        {t('← Safe Circle')}
      </a>
      <h1>{t('Privacy policy')}</h1>
      <p className="policy-updated">{t('Last updated {date}', { date: POLICY_UPDATED })}</p>
      {POLICY.map((section) => (
        <section key={section.title}>
          <h2>{t(section.title)}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{t(item, POLICY_FILL)}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
