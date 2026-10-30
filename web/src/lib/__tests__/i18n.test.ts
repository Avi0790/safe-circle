import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { es } from '../translations/es'
import { t } from '../i18n'

// Every English phrase the dashboard wraps in t() has Spanish, with the same
// {placeholders}.
const SRC = join(__dirname, '..', '..')
const files = [
  ...readdirSync(join(SRC, 'components')).map((name) => join(SRC, 'components', name)),
  join(SRC, 'App.tsx'),
].filter((path) => path.endsWith('.tsx'))

const literals = files.flatMap((path) =>
  [...readFileSync(path, 'utf8').matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map((m) =>
    (m[1] ?? m[2]).replace(/\\(.)/g, '$1'),
  ),
)
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()

describe('Spanish on the dashboard', () => {
  it('every phrase wrapped in t() has Spanish', () => {
    expect([...new Set(literals)].filter((text) => !(text in es))).toEqual([])
  })

  it('translations keep the English placeholders', () => {
    expect(Object.entries(es).filter(([en, sp]) => placeholders(en) !== placeholders(sp)).map(([en]) => en)).toEqual([])
  })

  it('English is the default where there is no browser to ask', () => {
    expect(t('Sign out')).toBe('Sign out')
    expect(t('Hello {name}', { name: 'Ana' })).toBe('Hello Ana')
  })
})
