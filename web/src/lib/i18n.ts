import { es } from './translations/es'

// English or Spanish, like the mobile app (mobile/lib/i18n.ts). Text is
// written in English and wrapped in t(); in Spanish the English is looked up
// in translations/es.ts, and anything not translated yet stays English. The
// choice follows the browser until someone picks one in the top bar; it's
// kept in this browser only (a page preference, nothing on the server).

export type Language = 'en' | 'es'

const KEY = 'safecircle.language'

export function browserLanguage(): Language {
  try {
    return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
  } catch {
    return 'en'
  }
}

function saved(): Language | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'en' || value === 'es' ? value : null
  } catch {
    return null
  }
}

let current: Language = saved() ?? browserLanguage()

export function language(): Language {
  return current
}

// Switch and redraw: the page reloads in the new language (the dashboard has
// no live data a reload would lose).
export function chooseLanguage(next: Language): void {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // not kept: the browser's language next time
  }
  current = next
  if (typeof window !== 'undefined') window.location.reload()
}

export function t(english: string, vars?: Record<string, string | number>): string {
  const text = current === 'es' ? (es[english] ?? english) : english
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole: string, name: string) => (name in vars ? String(vars[name]) : whole))
}
