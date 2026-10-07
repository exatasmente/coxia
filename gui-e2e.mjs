import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from '/home/luiz-neto/.local/share/cerimonias/workspaces/coxia/worktrees/coxia/105-say-on-the-runs-screen-when-a-labeled-is/node_modules/playwright-core/index.mjs';

const ROOT = '/home/luiz-neto/.local/share/cerimonias/workspaces/coxia/worktrees/coxia/105-say-on-the-runs-screen-when-a-labeled-is/gui-min/dist';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.webmanifest':'application/manifest+json', '.ico':'image/x-icon' };

const server = createServer((req,res) => {
  let p = decodeURIComponent((req.url||'/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)]||'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
console.log('SERVER', 'http://127.0.0.1:' + PORT);

const exec = '/home/luiz-neto/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exec, args: ['--no-sandbox'] });

const runIssue = (iid, title) => ({ iid, ref: 'app#'+iid, title, url: 'https://example.com/group/project/issues/'+iid });
const candidatesData = [ runIssue(101, 'Add the thing 101'), runIssue(102, 'Add the thing 102') ];
function makeRun(iid, rev) {
  return { version:1, rev, id:'r-'+String(iid)+'-aa',
    issue:{ ref:'app#'+iid, iid, title:'Add the thing '+iid, url:null },
    repo:'app', branch:'cycle/'+iid+'-test', worktree:'/tmp/wt', cycleFolder:'docs/cycles/'+iid+'-test',
    cycleId:'agent-flow', status:'working', stage:'refine',
    stages:[{ stage:'refine', agent:'product-owner', status:'running', artifacts:[], startedAt:null, endedAt:null, attempts:1, autonomous:true }],
    question:null, pending:null, returns:{}, wait:null, error:null, history:[],
    comments:{}, reviews:[], base:null, createdAt:'2026-10-07T10:00:00.000Z', updatedAt:'2026-10-07T10:00:00.000Z' };
}
const configView = { config: { setupComplete:true, language:'en',
  projects: { repos:[{ id:'app', path:'/tmp/app', remoteUrl:null, vcsId:null, projectPath:'group/project' }], issues:{ vcsId:null, project:'group/project', projectId:null, refPrefix:'app#', cardScope:'assigned', cardLabels:[] } },
  runner: { triggerLabel: 'cerimonia', enabled:true, worktreesDir:'/tmp/wt' },
  devCycle: { flows:{} }, squads: [], agents: { team: [] } },
  secrets:[], storage:{ source:'none', insecure:false }, requirements:[], claudeSdk:{ status:'none' }, workspaceId:'ws' };
const settingsData = { version:1, voice:{ enabled:false, speak:false, bargeIn:false, engine:'none' }, notifications:false, appearance:{ theme:'light' } };
const workspacesData = { list:[], running:null };

const DEFAULTS = { configView, settingsData, workspacesData, actions: [] };

function stubApi(page, overrides) {
  const src = `(iid, rev) => ({ version:1, rev, id:'r-'+String(iid)+'-aa',
    issue:{ ref:'app#'+iid, iid, title:'Add the thing '+iid, url:null },
    repo:'app', branch:'cycle/'+iid+'-test', worktree:'/tmp/wt', cycleFolder:'docs/cycles/'+iid+'-test',
    cycleId:'agent-flow', status:'working', stage:'refine',
    stages:[{ stage:'refine', agent:'product-owner', status:'running', artifacts:[], startedAt:null, endedAt:null, attempts:1, autonomous:true }],
    question:null, pending:null, returns:{}, wait:null, error:null, history:[],
    comments:{}, reviews:[], base:null, createdAt:'2026-10-07T10:00:00.000Z', updatedAt:'2026-10-07T10:00:00.000Z' })`;
  const merged = Object.assign({}, DEFAULTS, overrides);
  const data = Object.assign({}, merged, { src });
  return page.addInitScript((stuff) => {
    const { configView, settingsData, workspacesData, actions, candidates, runs, startMode, src } = stuff;
    const makeRun = Function('return ' + src)();
    const listeners = [];
    window.__fireEvent = (ev) => { for (const cb of listeners) { try { cb(ev); } catch(e) { console.error('onEvent', e); } } };
    const invoke = async (channel, ...args) => {
      switch (channel) {
        case 'config:get': return configView;
        case 'workspace:list': return workspacesData;
        case 'workspace:switch': return { restarting:false };
        case 'actions:list': return actions;
        case 'settings:get': return settingsData;
        case 'state:load': return null;
        case 'cards:load': return { cards: [], generatedAt: '2026-10-07T10:00:00.000Z', updated: false };
        case 'ceremony:commands': return [];
        case 'ceremony:command': return { ok: true };
        case 'voice:list': return { moderator: { engine:'none' }, agents: [] };
        case 'minutes:agenda': return { marks: {}, agenda: [] };
        case 'workspace:commands': return [];
        case 'runs:list': return runs;
        case 'runs:unassigned': return candidates;
        case 'runs:start': {
          if (startMode === 'ok') return makeRun(Number(String(args[0]).replace('app#','')) || 7, 9);
          throw new Error('declined: app#' + String(args[0]).replace('app#','') + ' already has a run');
        }
        default: return undefined;
      }
    };
    const api = { invoke, onEvent: (cb) => { listeners.push(cb); return () => {}; }, copy: async () => undefined };
    for (const m of ['saveState','listHistory','getHistory','prepareTurn','reply','deepAsk','deepOptions','teamsText','saveMinutes','planSpeech','speakSegment','cancelSpeech','transcribe','saveSettings','continueInClaude','checkStatus','detectRelease','previewAction','approveAction','skipAction','conflictAsk','conflictFromMr','conflictPrepare','conflictPropose','conflictChoose','conflictApply','conflictCommit','conflictReopen','conflictDiscard','gateOptions','startGate','getGate','answerGate','explainGate','visualGate','insertGateVisual','newGateRound','recordGate','prepareQa','getQa','askQa','writeQaChecklist','prepareRetro','latestRetro','askRetro']) {
      api[m] = async () => undefined;
    }
    window.api = api;
  }, data);
}

async function openPage(overrides) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await stubApi(page, overrides || {});
  await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const goRuns = () => page.evaluate(() => undefined);
  return { page, errors, goRuns };
}
const results = [];
async function scenario(name, fn) {
  try { const pass = await fn(); results.push({ name, pass: !!pass }); console.log('SCENARIO', name, pass ? 'PASS' : 'FAIL'); }
  catch (e) { results.push({ name, pass: false, error: String(e) }); console.log('SCENARIO', name, 'ERR', String(e)); }
}

const SELPT = 'Issues com rótulo e sem responsável';
const SEL = 'section[aria-label="' + SELPT + '"]';
const TITLE = SELPT;

await scenario('list-shows-open-unassigned-with-start-button', async () => {
  const { page, errors, goRuns } = await openPage({ runs: [], candidates: candidatesData, startMode: 'ok' });
  const before = await page.locator(SEL).count();
  await goRuns();
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log('  BODY', JSON.stringify(body));
  const sec = page.locator(SEL);
  const secCount = await sec.count();
  const title = secCount ? (await sec.locator('h2').textContent()) || '' : '';
  const items = secCount ? await sec.locator('ul li').count() : 0;
  const first = sec.locator('ul li').first();
  const firstText = items ? ((await first.textContent()) || '') : '';
  const firstBtnEnabled = items ? await first.locator('button').isEnabled() : false;
  await page.screenshot({ path: '/coxia/out/gui-list.png' });
  console.log('  before', before, 'sec', secCount, 'title', JSON.stringify(title), 'items', items, 'firstBtn', firstBtnEnabled, 'errs', errors);
  console.log('  text', JSON.stringify(firstText.replace(/\s+/g,' ').trim().slice(0,90)));
  await page.close();
  return secCount===1 && items===2 && title===TITLE && firstBtnEnabled && /app#101/.test(firstText);
});

await scenario('button-disabled-for-ref-with-existing-run', async () => {
  const { page, errors, goRuns } = await openPage({ runs: [ makeRun(101,1) ], candidates: candidatesData });
  await goRuns();
  await page.waitForTimeout(1200);
  const li = page.locator(SEL + ' ul li');
  const firstDisabled = await li.first().locator('button').isDisabled();
  const secondEnabled = await li.nth(1).locator('button').isEnabled();
  await page.screenshot({ path: '/coxia/out/gui-disabled.png' });
  console.log('  firstDisabled', firstDisabled, 'secondEnabled', secondEnabled, 'errs', errors);
  await page.close();
  return firstDisabled && secondEnabled;
});

await scenario('refusal-shows-reason-on-screen', async () => {
  const { page, errors, goRuns } = await openPage({ runs: [], candidates: candidatesData, startMode: 'no' });
  await goRuns();
  await page.waitForTimeout(1200);
  const sec = page.locator(SEL);
  await sec.locator('ul li').first().locator('button').click();
  await page.waitForTimeout(600);
  const errCount = await sec.locator('span.error').count();
  const errText = errCount ? (await sec.locator('span.error').textContent()) || '' : '';
  await page.screenshot({ path: '/coxia/out/gui-refusal.png' });
  console.log('  errCount', errCount, 'errText', JSON.stringify(errText), 'errs', errors);
  await page.close();
  return errCount>=1 && /already has a run/.test(errText);
});

await scenario('section-hides-when-list-empty', async () => {
  const { page, errors, goRuns } = await openPage({ runs: [], candidates: [] });
  await goRuns();
  await page.waitForTimeout(1200);
  const count = await page.locator(SEL).count();
  await page.screenshot({ path: '/coxia/out/gui-empty.png' });
  console.log('  empty section count', count, 'errs', errors);
  await page.close();
  return count===0;
});

await scenario('nothing-starts-on-its-own', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await stubApi(page, { runs: [], candidates: candidatesData, startMode: 'no' });
  await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__started = [];
    const raw = window.api.invoke.bind(window.api);
    window.api.invoke = (ch, ...a) => { if (ch === 'runs:start') window.__started.push([ch, a]); return raw(ch, ...a); };
  });
  await page.waitForTimeout(1200);
  const starts = await page.evaluate(() => window.__started || []);
  const count = await page.locator(SEL).count();
  console.log('  self-starts', starts.length, 'section', count, 'errs', errors);
  await page.close();
  return starts.length===0 && count===1;
});

await scenario('click-start-creates-run-and-navigates', async () => {
  const page = await browser.newPage();
  await stubApi(page, { runs: [], candidates: [ runIssue(102, 'Add the thing 102') ], startMode: 'ok' });
  await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const sec = page.locator(SEL);
  await sec.locator('ul li').first().locator('button').click();
  await page.waitForTimeout(800);
  const nav = await page.evaluate(() => window.__nav || []);
  await page.screenshot({ path: '/coxia/out/gui-started.png' });
  console.log('  nav', JSON.stringify(nav));
  await page.close();
  return nav.some((n) => n.name === 'run' && n.id);
});

console.log('RESULT', JSON.stringify(results, null, 2));
await browser.close();
server.close();
