// The capture of the paired phone: the app's own web mode (the companion the person pairs), in a window 390 px wide, over the copy
// of the seeded workspace that web.json in the seed points at. The data folder of the copy carries the session of the paired phone,
// so the window opens the companion itself and not the pairing screen; the person's own data is never touched.
//
// The profile of the browser is a throwaway folder under the system's temporary folder: a profile left inside the repository
// would be committed by an `git add` and no check covers it. The workspace configures no code host, so the app names none.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { PHONE_TOKEN } from '../seed-docs-workspace.mjs';
import { SAME_PIXELS, STILL, settle, waitForText } from './shared.mjs';

export async function capture({ lang, root, clock }) {
  const base = 'http://127.0.0.1:4330/cerimonias/';
  const profile = mkdtempSync(join(tmpdir(), 'coxia-phone-profile-'));
  const context = await chromium.launchPersistentContext(profile, { args: ['--no-sandbox', ...SAME_PIXELS], viewport: { width: 390, height: 844 }, locale: lang === 'en' ? 'en-US' : 'pt-BR', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' });
  // The phone draws the day from its own clock: it stands at the seed's day, as the app's does.
  if (clock) await context.addInitScript(clock.install, clock.at);
  await context.addCookies([{ name: 'cer_session', value: PHONE_TOKEN, domain: '127.0.0.1', path: '/cerimonias/' }]);
  const page = await context.newPage();
  try {
    await page.goto(base);
    await waitForText(page, ['Hoje', 'Today', 'Celular', 'Phone', 'Pareado', 'Paired'], 15000);
    await page.addStyleTag({ content: STILL }).catch(() => undefined);
    await settle(page);
    const name = lang === 'en' ? 'phone-en.png' : 'phone.png';
    await page.screenshot({ path: join(root, 'docs', 'images', name) });
    return { name, data: readFileSync(join(root, 'docs', 'images', name)) };
  } finally {
    await context.close().catch(() => undefined);
    // The browser may still be writing its profile for a moment after it closes.
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
