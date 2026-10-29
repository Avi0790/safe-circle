import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// A check over the dashboard's source and colours, so a new page can't
// quietly shut out keyboard and screen-reader users or fail contrast.

const SRC = join(__dirname, '..', '..')
const components = readdirSync(join(SRC, 'components'))
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ({ name, source: readFileSync(join(SRC, 'components', name), 'utf8') }))
const css = readFileSync(join(SRC, 'index.css'), 'utf8')

// The opening tag starting at `start`, braces included (props hold arrows).
function openingTag(source: string, start: number): string {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0 && source[i - 1] !== '=') return source.slice(start, i + 1)
  }
  return source.slice(start)
}

function tags(tag: string) {
  return components.flatMap(({ name, source }) =>
    [...source.matchAll(new RegExp(`<${tag}\\b`, 'g'))].map((m) => ({
      where: `${name}:${source.slice(0, m.index).split('\n').length}`,
      tag: openingTag(source, m.index!),
      before: source.slice(Math.max(0, m.index! - 120), m.index),
    })),
  )
}

// WCAG relative luminance and contrast ratio
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]))
}

describe('accessibility', () => {
  it('anything clickable works from the keyboard: a button, or a role="button" with Enter and Space', () => {
    const clickable = ['div', 'span', 'li', 'tr', 'td', 'p', 'section', 'img']
      .flatMap((tag) => tags(tag))
      .filter(({ tag }) => /\sonClick=/.test(tag))
      .filter(({ tag }) => !(/role=/.test(tag) && /tabIndex=/.test(tag) && /onKeyDown=\{[^}]*activateOnKey\(/.test(tag)))
      .map((t) => t.where)
    expect(clickable).toEqual([])
  })

  it('every form field has a name: a wrapping <label>, a label for its id, or aria-label', () => {
    const unnamed = [...tags('input'), ...tags('select'), ...tags('textarea')]
      .filter(({ tag, before }) => {
        if (/aria-label=/.test(tag)) return false
        const id = tag.match(/\bid="([^"]+)"/)?.[1]
        if (id && components.some(({ source }) => source.includes(`htmlFor="${id}"`))) return false
        // inside a <label> that hasn't closed yet
        return before.lastIndexOf('<label') <= before.lastIndexOf('</label>')
      })
      .map((t) => t.where)
    expect(unnamed).toEqual([])
  })

  it('errors and SOS alerts are announced as they appear', () => {
    const silent = components
      .filter(({ source }) => /<p className="(org-)?error">/.test(source) || /<div className="sos-banner">/.test(source))
      .map((c) => c.name)
    expect(silent).toEqual([])
  })

  it('table column headers say they head a column', () => {
    const bare = tags('th').filter(({ tag }) => !tag.includes('scope=')).map((t) => t.where)
    expect(bare).toEqual([])
  })

  it('keyboard focus is always visible', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px/)
    expect(css).not.toMatch(/outline:\s*(none|0)\b/)
  })

  it('text colours meet WCAG AA (4.5:1) in light and dark', () => {
    const light = tokens(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')))
    const dark = { ...light, ...tokens(css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))) }
    for (const [theme, t] of Object.entries({ light, dark })) {
      for (const text of ['text', 'text-h', 'muted', 'warn-text', 'accent', 'danger']) {
        for (const surface of ['bg', 'bg-elevated']) {
          const ratio = contrast(t[text], t[surface])
          expect({ theme, text, surface, ok: ratio >= 4.5 }).toEqual({ theme, text, surface, ok: true })
        }
      }
    }
  })
})
