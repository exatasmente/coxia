// QA scratch driver: points the running window at the app's own build with a stubbed web bridge, so the screen gets the exact payloads the main process would serve.
// The stub is injected before the app's module graph runs; the app itself is untouched.
import { chromium } from 'playwright-core';

const OUT = '/coxia/out';
const log = (...a) => console.log(...a);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
await page.waitForLoadState('domcontentloaded');

// The payloads the main process would return: one unassigned labeled issue already listed in the runs, one without a run, then the empty list.
await page.addInitScript(() => {
  const failed = { on: false };
  window.__qa = { startCalls: [], unassignedReads: 0, failed };
  const unassigned = () => {
    window.__qa.unassignedReads += 1;
    return failed.on ? [] : [{ iid: 61, ref: 'app#61', title: 'Add the thing 61', url: 'https://example.com/group/project/issues/61' }];
  };
  const runs = [{ id: 'run-60', rev: 1, issue: { iid: 60, ref: 'app#60', title: 'Add the thing 60', url: null }, status: 'done', stage: 'ready', squad: null, updatedAt: '2026-10-07T10:00:00.000Z', comments: {}, qa: [], reviews: [] }];
  const listeners = new Set();
  const invoke = async (channel, ...args) => {
    if (channel === 'runs:unassigned') return unassigned();
    if (channel === 'runs:start') { window.__qa.startCalls.push(args[0]); throw new Error('Error invoking remote method \'runs:start\': Error: cannot start run for issue app#61'); }
    if (channel === 'runs:list') return runs;
    if (channel === 'config:get') return { config: null, secrets: [], storage: null, requirements: [], claudeSdk: null, workspaceId: 'testes' };
    if (channel === 'settings:get') return { language: 'pt-BR', voice: { enabled: false, speak: false, bargeIn: true }, notifications: false };
    if (channel === 'workspace:list') return { current: 'testes', list: [], running: 'testes' };
    if (channel === 'cycle:view') return { templateId: 'agent-flow', templateName: 'agent flow', language: 'pt-BR', userName: '', ceremonies: {}, preDailyLabel: 'Pré-daily', stages: [], meanings: {}, destination: {}, terms: {}, host: {}, workspaceId: 'testes' };
    if (channel === 'cards:load') return { cards: [], plan: null };
    if (channel === 'state:load') return null;
    if (channel === 'activity:get') return [];
    if (channel === 'update:busy') return false;
    return null;
  };
  window.api = { invoke, copy: async () => undefined, onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); } };
});

await page.goto('file:///home/luiz-neto/.local/share/cerimonias/workspaces/coxia/worktrees/coxia/105-say-on-the-runs-screen-when-a-labeled-is/out/renderer/index.html');
await page.waitForTimeout(2500);
log('stub page', await page.evaluate(() => document.documentElement.lang));

await page.locator('.dash-nav').getByRole('button', { name: 'Execuções', exact: true }).click();
await page.waitForTimeout(1200);

const section = page.locator('section[aria-label="Issues com rótulo e sem responsável"]');
log('section visible:', await section.isVisible().catch(() => false));
log('scenario 1 - the item:', (await section.locator('li').first().innerText()).replace(/\n/g, ' | '));
log('buttons:', JSON.stringify(await section.getByRole('button').allTextContents()));
log('disabled flags:', JSON.stringify(await section.getByRole('button').evaluateAll((bs) => bs.map((b) => b.disabled))));
await page.screenshot({ path: `${OUT}/qa-section.png`, fullPage: true });

log('scenario 5 - start calls before the click:', JSON.stringify(await page.evaluate(() => window.__qa.startCalls)));
await section.getByRole('button').first().click();
await page.waitForTimeout(1500);
log('scenario 5 - start calls after the click:', JSON.stringify(await page.evaluate(() => window.__qa.startCalls)));
const alert = page.locator('.cy-inline-error');
log('scenario 8 - refusal:', await alert.count(), JSON.stringify(await alert.allTextContents()), JSON.stringify(await alert.first().getAttribute('role')));
await page.screenshot({ path: `${OUT}/qa-refusal.png`, fullPage: true });

// The same section, now with the list the app serves when the issue the person just started is the one already in the runs.
await page.evaluate(() => { window.__qa.failed.on = false; window.__qa.startCalls.length = 0; });
await page.evaluate(() => {
  const stub = window.__qa;
  const original = window.api.invoke;
  window.api.invoke = async (channel, ...args) => (channel === 'runs:unassigned' ? [{ iid: 60, ref: 'app#60', title: 'Add the thing 60', url: null }] : original(channel, ...args));
});
await page.locator('.cy-top .btn.icon-btn').click();
await page.waitForTimeout(500);
await page.locator('.dash-nav').getByRole('button', { name: 'Execuções', exact: true }).click();
await page.waitForTimeout(1200);
log('scenario 7 - disabled for a ref already in the runs:', JSON.stringify(await page.locator('section[aria-label="Issues com rótulo e sem responsável"]').getByRole('button').evaluateAll((bs) => bs.map((b) => b.disabled))));
await page.screenshot({ path: `${OUT}/qa-disabled.png`, fullPage: true });

// Scenario 9: the empty list hides the section.
await page.evaluate(() => {
  const stub = window.__qa;
  const original = window.api.invoke;
  window.api.invoke = async (channel, ...args) => (channel === 'runs:unassigned' ? [] : original(channel, ...args));
});
await page.locator('.cy-top .btn.icon-btn').click();
await page.waitForTimeout(500);
await page.locator('.dash-nav').getByRole('button', { name: 'Execuções', exact: true }).click();
await page.waitForTimeout(1200);
log('scenario 9 - section with an empty list:', await page.locator('section[aria-label="Issues com rótulo e sem responsável"]').count());
log('scenario 9 - the screen itself is there:', await page.locator('.cy-title').innerText());
await page.screenshot({ path: `${OUT}/qa-empty.png`, fullPage: true });

await browser.close();
