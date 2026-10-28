import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// A check over the app's source, so a new screen can't quietly skip
// VoiceOver: every tappable thing says it's a button (or tab, link...),
// every switch and text box has a name, and no button hides inside another
// one where VoiceOver can't reach it.

const ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

const files = [...sourceFiles(join(ROOT, 'app')), ...sourceFiles(join(ROOT, 'components'))].map((path) => ({
  name: relative(ROOT, path),
  source: readFileSync(path, 'utf8'),
}));

// The opening tag starting at `start`, braces included (props hold arrows).
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && source[i - 1] !== '=') return source.slice(start, i + 1);
  }
  return source.slice(start);
}

function tags(component: string) {
  return files.flatMap(({ name, source }) =>
    [...source.matchAll(new RegExp(`<${component}\\b`, 'g'))].map((m) => ({
      where: `${name}:${source.slice(0, m.index).split('\n').length}`,
      tag: openingTag(source, m.index!),
      start: m.index!,
      source,
    })),
  );
}

describe('accessibility', () => {
  it('every Pressable has a role, or is explicitly not one VoiceOver element', () => {
    const missing = tags('Pressable')
      .filter(({ tag }) => !/accessibilityRole=|role=/.test(tag) && !tag.includes('accessible={false}'))
      .map((t) => t.where);
    expect(missing).toEqual([]);
  });

  it('every switch and text box has a name for VoiceOver', () => {
    const missing = [...tags('Switch'), ...tags('TextInput')]
      .filter(({ tag }) => !tag.includes('accessibilityLabel'))
      .map((t) => t.where);
    expect(missing).toEqual([]);
  });

  it('no control sits inside a Pressable that VoiceOver reads as one element', () => {
    const nested = tags('Pressable')
      .filter(({ tag }) => !tag.includes('accessible={false}'))
      .filter(({ source, start }) => {
        // the Pressable's body, up to its matching close
        let depth = 0;
        const re = /<Pressable\b|<\/Pressable>/g;
        re.lastIndex = start;
        let end = source.length;
        for (let m = re.exec(source); m; m = re.exec(source)) {
          depth += m[0].startsWith('</') ? -1 : 1;
          if (depth === 0) {
            end = m.index;
            break;
          }
        }
        const body = source.slice(start + openingTag(source, start).length, end);
        return /<(Pressable|Button|Switch|TextInput|TextField|HeroButton|Chip)\b/.test(body);
      })
      .map((t) => t.where);
    expect(nested).toEqual([]);
  });

  it('error messages are read aloud (ErrorText), not shown silently', () => {
    const silent = files
      .filter(({ source }) => /<Text style=\{\w+\.error\}>\{\w+\}<\/Text>/.test(source))
      .map((f) => f.name);
    expect(silent).toEqual([]);
  });
});
