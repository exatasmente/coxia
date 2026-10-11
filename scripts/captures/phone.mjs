// The capture of the paired phone: the app's own web mode (the companion the person pairs), in a window 390 px wide, over the copy
// of the seeded workspace that web.json in the seed points at. The data folder of the copy carries the session of the paired phone,
// so the window opens the companion itself and not the pairing screen; the person's own data is never touched.
//
// The profile of the browser is a throwaway folder under the system's temporary folder: a profile left inside the repository
// would be committed by an `git add` and no check covers it. The sentences the app writes with its own vocabulary name the code
// host, which this workspace does not configure, so the vendor phrase is taken out of the window before the picture.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { PHONE_TOKEN } from '../seed-docs-workspace.mjs';
import { settle, waitForText } from './shared.mjs';

const HOST_WORDS = { 'pt-BR': 'provedor de código', en: 'the code host' };

export async function capture({ dataDir, lang, out, root, drop }) {
  const base = 'http://127.0.0.1:4330/cerimonias/';
  const profile = mkdtempSync(join(tmpdir(), 'coxia-phone-profile-'));
  const context = await chromium.launchPersistentContext(profile, { args: ['--no-sandbox'], viewport: { width: 390, height: 844 }, locale: lang === 'en' ? 'en-US' : 'pt-BR' });
  await context.addCookies([{ name: 'cer_session', value: PHONE_TOKEN, domain: '127.0.0.1', path: '/cerimonias/' }]);
  const page = await context.newPage();
  try {
    await page.goto(base);
    await waitForText(page, ['Hoje', 'Today', 'Celular', 'Phone', 'Pareado', 'Paired'], 15000);
    await drop?.([HOST_WORDS[lang] ?? HOST_WORDS['pt-BR']]);
    await settle(page);
    const name = lang === 'en' ? 'phone-en.png' : 'phone.png';
    await page.screenshot({ path: join(root, 'docs', 'images', name) });
    return { name, data: readFileSync(join(root, 'docs', 'images', name)) };
  } finally {
    await context.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
}
