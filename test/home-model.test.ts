// The home as plain functions and a scan of the sources: one constant is where the app opens and where every "back" goes, so which screen is the home is decided in one place.
// No component is rendered (the runner is a node environment), so the scan is how "every back asks for it" is held.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME, deepBack } from '../src/renderer/src/home';

const ROOT = join(import.meta.dirname, '..');
const sources = readdirSync(join(ROOT, 'src/renderer/src'), { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(ROOT, 'src/renderer/src', f), 'utf8') }));

describe('the home', () => {
  it('is the Overview for now, the screen that holds what Today held', () => {
    expect(HOME).toEqual({ name: 'overview' });
  });

  it('is where a deep dive goes back to unless it came from the pre-daily', () => {
    expect(deepBack('chat')).toBe(HOME);
    expect(deepBack('call')).toEqual({ name: 'call' });
  });
});

describe('the screens that go back to the start', () => {
  it('ask for the home and never name it, so the day the home changes no screen has to', () => {
    // The only places that write the name of a screen that is the Overview: the home itself and the vocabulary of the targets.
    const naming = sources.filter((s) => /name: 'overview'/.test(s.text) && !s.file.endsWith('App.tsx')).map((s) => s.file).sort();
    expect(naming).toEqual(['home.ts', 'pushTarget.ts']);
  });

  it('keep no screen called today: the name is the Overview\'s now', () => {
    expect(sources.filter((s) => /name: 'today'/.test(s.text)).map((s) => s.file)).toEqual([]);
    expect(sources.some((s) => s.file.endsWith('screens/Today.tsx'))).toBe(false);
    expect(sources.some((s) => s.file.endsWith('screens/Overview.tsx'))).toBe(true);
  });

  it('use the home in every screen that has a back button to the start, and import it', () => {
    const users = sources.filter((s) => !s.file.endsWith('home.ts') && /go\(HOME\)|back = HOME|\? HOME :|<Screen>\(HOME\)|: HOME;|\bHOME\)/.test(s.text));
    // the screens that returned to Today (and App, which opens on it): none of them calls a constant it does not import
    expect(users.length).toBeGreaterThanOrEqual(26);
    for (const s of users) expect(s.text, s.file).toMatch(/import \{[^}]*\bHOME\b[^}]*\} from '(\.\.\/)*(\.\/)?home'/);
  });
});
