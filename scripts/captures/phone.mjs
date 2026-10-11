// The capture of the paired phone: the app's own web mode (the companion the person pairs), in a window 390 px wide, over the copy
// of the seeded workspace that web.json in the seed points at. The data folder of the copy carries the session of the paired phone,
// so the window opens the companion itself and not the pairing screen; the person's own data is never touched.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { PHONE_DATA_DIR, PHONE_TOKEN } from '../seed-docs-workspace.mjs';
import { settle, waitForText } from './shared.mjs';

export async function capture({ dataDir, lang, out, root }) {
  const base = 'http://127.0.0.1:4330/cerimonias/';
  const browser = await chromium.launch({ args: ['--no-sandbox', `--user-data-dir=${join(out, '.phone-profile')}`] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'en' ? 'en-US' : 'pt-BR' });
  await context.addCookies([{ name: 'cer_session', value: PHONE_TOKEN, domain: '127.0.0.1', path: '/cerimonias/' }]);
  const page = await context.newPage();
  try {
    await page.goto(base);
    await waitForText(page, ['Hoje', 'Today', 'Celular', 'Phone', 'Pareado', 'Paired'], 15000);
    await settle(page);
    const name = lang === 'en' ? 'phone-en.png' : 'phone.png';
    await page.screenshot({ path: join(root, 'docs', 'images', name) });
    return { name, data: readFileSync(join(root, 'docs', 'images', name)) };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export { PHONE_DATA_DIR };
