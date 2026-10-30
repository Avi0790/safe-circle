import { readFileSync } from 'fs'
import { join } from 'path'
import { POLICY } from '../privacyPolicy'
import { es } from '../translations/es'

// The web's privacy policy is a copy of the app's (mobile/lib/privacyPolicy.ts),
// so people read the same promises wherever they look.
const fromFirstExport = (path: string) => {
  const text = readFileSync(path, 'utf8')
  return text.slice(text.indexOf('export const POLICY_UPDATED'))
}

describe('privacy policy', () => {
  it('says exactly what the app says', () => {
    const web = fromFirstExport(join(__dirname, '..', 'privacyPolicy.ts'))
    const app = fromFirstExport(join(__dirname, '..', '..', '..', '..', 'mobile', 'lib', 'privacyPolicy.ts'))
    expect(web).toBe(app)
  })

  it('is in Spanish, every heading and line', () => {
    expect(POLICY.flatMap((s) => [s.title, ...s.items]).filter((text) => !(text in es))).toEqual([])
  })
})
