// Where each notice of the main process leads now that the app opens on a chat: the pre-daily notice opens the chat (which pins the ceremony card), the tray's "ceremony now"
// keeps the pre-daily screen, and every notice about cards opens the Overview. Read from the sources, because the senders sit inside timers and watchers that no test drives.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUSH_SCREENS, parseTarget } from '../src/shared/push';

const ROOT = join(import.meta.dirname, '..');
const main = readdirSync(join(ROOT, 'src/main'), { recursive: true })
  .map(String)
  .filter((f) => /\.ts$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(ROOT, 'src/main', f), 'utf8') }));

/** Every `to` a notice of the main process says it navigates to, by file. */
const navigates = (file: string): string[] => [...(main.find((s) => s.file === file)?.text ?? '').matchAll(/type: 'navigate', to: '(\w+)'/g)].map((m) => m[1]);

describe('the notices of the main process', () => {
  it('opens the chat for the pre-daily notice, the retro for its own, and the Overview for the status notices of the scheduler', () => {
    expect(navigates('scheduler.ts').sort()).toEqual(['chat', 'overview', 'overview', 'overview', 'retro']);
    expect(main.find((s) => s.file === 'scheduler.ts')?.text).toMatch(/cycle\.notice\.preDailyTitle[^\n]*to: 'chat'/);
  });

  it.each(['watchers.ts', 'feedback.ts', 'runner/module.ts', 'turnAsks.ts'])('opens the Overview for the notices about cards in %s', (file) => {
    const list = navigates(file);
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list)).toEqual(new Set(['overview']));
  });

  it('names no notice after Today, which is not a screen any more', () => {
    expect(main.filter((s) => /type: 'navigate', to: 'today'/.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('keeps the pre-daily screen for the tray\'s "ceremony now": an explicit request to hold it', () => {
    expect(main.find((s) => s.file === 'index.ts')?.text).toMatch(/main\.tray\.ceremonyNow[^\n]*go\('call'\)/);
  });

  it('only sends names the phone and the window both know', () => {
    for (const file of ['scheduler.ts', 'watchers.ts', 'feedback.ts', 'runner/module.ts', 'turnAsks.ts']) for (const to of navigates(file)) expect(PUSH_SCREENS, `${file}: ${to}`).toContain(to);
    for (const to of ['chat', 'overview', 'today', 'call']) expect(parseTarget({ to }), to).toEqual({ to });
  });
});
