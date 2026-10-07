import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
const probe = await page.evaluate(() => ({ url: location.href, hasQa: '__qa' in window, reads: window.__qa?.unassignedReads ?? null }));
console.log(JSON.stringify(probe));
console.log('title', await page.locator('.cy-title').innerText().catch(() => null));
await browser.close();
