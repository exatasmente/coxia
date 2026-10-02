#!/usr/bin/env node
// Local end-to-end test of the published-release update path: a real packaged AppImage (the old version) finds, downloads and installs a
// newer one that a local HTTP server serves with a latest-linux.yml, restarts into it and says so.
//
//   node scripts/update-e2e.mjs --old <old.AppImage> --new <folder with the new .AppImage and latest-linux.yml> --work <scratch folder> \
//                               [--scenario main|tamper|older|beta|onquit|source] [--commit <build commit>] [--port 9326] [--debug-port 9325]
//
// Both AppImages must have been built with `publish: {provider: generic, url: http://127.0.0.1:<port>/}` (see docs/updates.md, "Testing an
// update locally"). Nothing real is touched: the app runs with its own HOME, XDG_* and CERIMONIAS_DATA_DIR inside --work, a PATH without
// the user's tools, and the installed copy lives in <work>/prefix. The window opens (the relaunch shows it), so a screen is needed.
//
// Scenarios:
//   main    check, download (differential), busy refusal, install, relaunch, toast, the installed file is the served one
//   tamper  the served latest-linux.yml carries a wrong sha512: the download must fail and nothing is installed
//   older   the feed offers an older version: no update is offered (no downgrade)
//   beta    only beta-linux.yml is served: the stable channel finds nothing, the beta channel finds the update
//   onquit  a downloaded update is installed by a normal quit, but not while something is running
//   source  installed by scripts/install-local.sh from a throwaway clone whose main is two commits ahead of the build (needs --commit,
//           the commit the old AppImage was built from): the badge, the commit list, the override, a read-only check, the update button
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OLD = resolve(opt('--old', ''));
const NEW = resolve(opt('--new', ''));
const WORK = resolve(opt('--work', ''));
const SCENARIO = opt('--scenario', 'main');
const COMMIT = opt('--commit');
const PORT = Number(opt('--port', '9326'));
const DEBUG = Number(opt('--debug-port', '9325'));
if (!opt('--old') || !opt('--new') || !opt('--work')) {
  console.error('usage: update-e2e.mjs --old <old.AppImage> --new <folder> --work <folder> [--scenario main|tamper|older|beta]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}] ${m}`);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
};
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(500);
  }
}
const sha512 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64');

// ---- the isolated world ---------------------------------------------------------------------------------------------------------------
const dir = (n) => join(WORK, n);
rmSync(WORK, { recursive: true, force: true });
for (const n of ['home', 'data', 'state', 'cache', 'config', 'xdgdata', 'prefix', 'feed']) mkdirSync(dir(n), { recursive: true });
const APP = join(dir('prefix'), 'cerimonias.AppImage');
if (SCENARIO !== 'source') {
  copyFileSync(OLD, APP);
  execFileSync('chmod', ['755', APP]);
}
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

const newImage = readdirSync(NEW).find((f) => f.endsWith('.AppImage'));
if (!newImage) throw new Error(`no .AppImage in ${NEW}`);
let yml = readFileSync(join(NEW, 'latest-linux.yml'), 'utf8');
cpSync(join(NEW, newImage), join(dir('feed'), newImage));
const newVersion = /^version: (.+)$/m.exec(yml)?.[1];
if (SCENARIO === 'main' || SCENARIO === 'onquit') yml += 'releaseNotes: |\n  - Faster start\n  - Fixes for the <b>voice</b> panel\n';
if (SCENARIO === 'tamper') yml = yml.replace(/sha512: .+/g, `sha512: ${Buffer.alloc(64, 7).toString('base64')}`);
if (SCENARIO === 'older') yml = yml.replace(/^version: .+$/m, 'version: 0.0.9').replace(/cerimonias-[\d.]+\.AppImage/g, 'cerimonias-0.0.9.AppImage');
writeFileSync(join(dir('feed'), SCENARIO === 'beta' ? 'beta-linux.yml' : 'latest-linux.yml'), yml);
say(`scenario ${SCENARIO}: old ${OLD} (${statSync(OLD).size} bytes) -> feed ${newImage} (${statSync(join(NEW, newImage)).size} bytes, version ${newVersion})`);

const env = {
  PATH: '/usr/bin:/bin',
  HOME: dir('home'),
  DISPLAY: process.env.DISPLAY ?? ':0',
  ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? '',
  XDG_CONFIG_HOME: dir('config'),
  XDG_DATA_HOME: dir('xdgdata'),
  XDG_STATE_HOME: dir('state'),
  XDG_CACHE_HOME: dir('cache'),
  CERIMONIAS_DATA_DIR: dir('data'),
};
const APP_ARGS = ['--no-sandbox', `--remote-debugging-port=${DEBUG}`];

const feedLog = join(WORK, 'feed.jsonl');
const server = spawn('node', [join(import.meta.dirname, 'update-e2e-server.mjs'), '--dir', dir('feed'), '--port', String(PORT), '--log', feedLog], { stdio: 'ignore' });

const appLog = join(WORK, 'app.log');
function launch(extra = []) {
  const out = execFileSync('bash', ['-c', `exec setsid -f "${APP}" ${[...APP_ARGS, ...extra].join(' ')} >>"${appLog}" 2>&1 </dev/null`], { env, stdio: 'ignore' });
  return out;
}
const runPid = () => {
  try {
    return JSON.parse(readFileSync(join(dir('data'), 'run.json'), 'utf8'));
  } catch {
    return null;
  }
};

// ---- Chrome DevTools Protocol against the app's window ----------------------------------------------------------------------------------
async function target() {
  const list = await fetch(`http://127.0.0.1:${DEBUG}/json`).then((r) => r.json());
  return list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
}
async function cdp() {
  const t = await waitFor(() => target().catch(() => null), 60_000, 'the app window');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) waiting.get(d.id)(d);
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id;
      waiting.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result?.result?.value;
    },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      if (r.result?.data) writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    },
    close: () => ws.close(),
  };
}
const invoke = (page, channel, ...a) => page.eval(`window.api.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(a)})`);
async function waitStatus(page, pred, ms, what) {
  return waitFor(async () => {
    const s = await invoke(page, 'update:status');
    return pred(s) ? s : null;
  }, ms, what);
}
const feedRequests = () => (existsSync(feedLog) ? readFileSync(feedLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function quit() {
  const pid = runPid()?.pid;
  execFileSync('bash', ['-c', `timeout 30 "${APP}" ${APP_ARGS.join(' ')} --quit-for-update >/dev/null 2>&1 || true`], { env, stdio: 'ignore' });
  if (pid) await waitFor(() => !alive(pid), 30_000, 'the app to quit').catch(() => process.kill(pid, 'SIGKILL'));
}

// ---- scenarios -------------------------------------------------------------------------------------------------------------------------
// A throwaway clone whose main is two commits beyond the commit the AppImage was built from, installed the way a source install is:
// by the clone's own scripts/install-local.sh, which records the tree next to the installed app.
function installFromSource() {
  if (!COMMIT) throw new Error('the source scenario needs --commit <the commit the old AppImage was built from>');
  const tree = dir('tree');
  git(WORK, 'clone', '-q', resolve(import.meta.dirname, '..'), tree);
  git(tree, 'checkout', '-q', '-B', 'main', COMMIT);
  for (const [i, subject] of ['feat: second thing', 'fix: third thing'].entries()) {
    writeFileSync(join(tree, 'e2e-marker.txt'), `${i}\n`);
    git(tree, 'add', 'e2e-marker.txt');
    git(tree, 'commit', '-q', '-m', subject);
  }
  execFileSync('bash', [join(tree, 'scripts/install-local.sh'), '--artifact', OLD], { env: { ...env, CERIMONIAS_PREFIX: dir('prefix') }, stdio: 'ignore' });
  return tree;
}

async function sourceScenario() {
  const tree = installFromSource();
  const record = JSON.parse(readFileSync(join(dir('state'), 'cerimonias/install-source.json'), 'utf8'));
  check('install-local.sh recorded the source tree and the installed AppImage', record.source === tree && record.appImage === APP, JSON.stringify(record));
  const fingerprint = () => [git(tree, 'rev-parse', 'HEAD'), git(tree, 'for-each-ref'), git(tree, 'status', '--porcelain')].join('\n');
  const before = fingerprint();
  launch();
  const first = await waitFor(() => runPid(), 90_000, 'the instance (run.json)');
  say(`instance pid ${first.pid}, version ${first.version}, commit ${first.commit}`);
  const page = await cdp();
  let status = await invoke(page, 'update:status');
  check('mode is "source", detected from the record', status.mode.mode === 'source' && status.mode.reason === 'source', `${status.mode.mode}/${status.mode.reason}`);
  status = await invoke(page, 'update:check');
  check('main is 2 commits ahead of the installed build', status.source.ahead === 2 && status.source.error === null, JSON.stringify({ ahead: status.source.ahead, error: status.source.error, installed: status.source.installed }));
  check('the commits since the installed one are listed, newest first', status.source.commits.map((c) => c.subject).join('|') === 'fix: third thing|feat: second thing');
  check('the badge is on', status.badge === true);
  await sleep(1000);
  await page.shot(join(WORK, 'hoje-badge.png')).catch(() => undefined);
  await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Configurações')?.click()");
  await sleep(800);
  await page.eval("document.getElementById('updates')?.scrollIntoView({ block: 'start' })");
  await sleep(500);
  await page.shot(join(WORK, 'settings-updates.png')).catch(() => undefined);
  check('the check wrote nothing to the source tree', fingerprint() === before);

  status = await invoke(page, 'update:settings-save', { ...status.settings, mode: 'release' });
  check('the override to release mode applies', status.mode.mode === 'release' && status.mode.reason === 'forced-release', `${status.mode.mode}/${status.mode.reason}`);
  status = await invoke(page, 'update:settings-save', { ...status.settings, mode: 'auto' });
  check('back to automatic detection', status.mode.mode === 'source');

  // the button runs the existing flow: scripts/update.sh of the recorded tree (here it stops at the build, which has no node_modules, and leaves the app alone)
  await invoke(page, 'update:run');
  const log = join(dir('state'), 'cerimonias/update.log');
  await waitFor(() => existsSync(log) && /atualizando a partir de/.test(readFileSync(log, 'utf8')), 30_000, 'update.sh to start');
  check('"Atualizar agora" runs update.sh from the recorded tree', readFileSync(log, 'utf8').includes(`atualizando a partir de ${tree}`));
  await waitFor(() => /compilação falhou|não achei o npm|erro:/.test(readFileSync(log, 'utf8')), 60_000, 'the stub build to fail');
  check('and the failed build leaves the running app alone', alive(first.pid));
  page.close();
}

async function main() {
  if (SCENARIO === 'source') return sourceScenario();
  launch();
  const first = await waitFor(() => runPid(), 90_000, 'the first instance (run.json)');
  say(`old instance pid ${first.pid}, version ${first.version}, commit ${first.commit}`);
  let page = await cdp();

  let status = await invoke(page, 'update:status');
  check('mode is "release" (published AppImage, loopback feed)', status.mode.mode === 'release', `${status.mode.mode}/${status.mode.reason}`);
  check('installed version is the old one', status.build.version === first.version);
  check('automatic checks are on by default', status.settings.auto === true && status.settings.channel === 'stable');

  if (SCENARIO === 'beta') {
    status = await invoke(page, 'update:check');
    check('stable channel finds nothing when only beta-linux.yml exists', status.release.phase === 'error' && status.release.lastResult === 'error', `${status.release.phase}: ${status.release.error}`.slice(0, 140));
    status = await invoke(page, 'update:settings-save', { ...status.settings, channel: 'beta' });
    status = await waitStatus(page, (s) => ['available', 'downloading', 'downloaded'].includes(s.release.phase), 90_000, 'the beta update');
    check('beta channel finds the update', status.release.version === newVersion, `${status.release.phase} ${status.release.version}`);
    return;
  }

  if (SCENARIO === 'older') {
    status = await invoke(page, 'update:check');
    check('an older version on the feed is not offered (no downgrade)', status.release.phase === 'idle' && status.release.lastResult === 'up-to-date', `${status.release.phase}/${status.release.lastResult}`);
    check('no badge', status.badge === false);
    return;
  }

  // detect + download in the background
  const checkedAt = Date.now();
  status = await invoke(page, 'update:check');
  check('the check found the new version', ['available', 'downloading', 'downloaded'].includes(status.release.phase) && status.release.version === newVersion, `${status.release.phase} ${status.release.version}`);

  if (SCENARIO === 'tamper') {
    status = await waitStatus(page, (s) => s.release.phase === 'error' || s.release.phase === 'downloaded', 120_000, 'the download to finish or fail');
    check('a wrong sha512 in latest-linux.yml fails the download', status.release.phase === 'error', `${status.release.phase}: ${status.release.error}`.slice(0, 160));
    check('nothing is installed or left downloaded', status.release.phase !== 'downloaded');
    const inst = await invoke(page, 'update:install', {});
    check('install is refused: not ready', inst.ok === false && inst.reason === 'not-ready', JSON.stringify(inst));
    check('the installed file is untouched', sha512(APP) === sha512(OLD));
    const errors = existsSync(join(dir('data'), 'logs/errors.jsonl')) ? readFileSync(join(dir('data'), 'logs/errors.jsonl'), 'utf8') : '';
    check('the failure reached the error log', /update:release/.test(errors));
    return;
  }

  const samples = [];
  status = await waitFor(async () => {
    const s = await invoke(page, 'update:status');
    if (s.release.progress) samples.push(Math.round(s.release.progress.percent));
    return s.release.phase === 'downloaded' ? s : s.release.phase === 'error' ? Promise.reject(new Error(s.release.error)) : null;
  }, 180_000, 'the update to download');
  say(`downloaded; progress samples: ${[...new Set(samples)].join(', ') || '(none seen)'}`);
  check('the update was downloaded in the background', status.release.phase === 'downloaded' && status.release.version === newVersion);
  check('the badge is on', status.badge === true);
  check('release notes arrive as plain text, markup stripped', status.release.notes === '- Faster start\n- Fixes for the voice panel', JSON.stringify(status.release.notes));

  const reqs = feedRequests().filter((r) => r.path.endsWith('.AppImage'));
  const bytes = reqs.reduce((n, r) => n + (r.bytes ?? 0), 0);
  const full = statSync(join(dir('feed'), newImage)).size;
  const parts = reqs.filter((r) => r.status === 206).length;
  say(`feed served ${reqs.length} AppImage request(s), ${bytes} bytes of ${full} (${((bytes / full) * 100).toFixed(1)}%), ${parts} range response(s)`);
  writeFileSync(join(WORK, 'differential.json'), JSON.stringify({ requests: reqs.length, rangeResponses: parts, bytesServed: bytes, fullSize: full, percent: (bytes / full) * 100 }, null, 2));
  check('the download was differential (ranges, far less than the full file)', parts > 0 && bytes < full * 0.5, `${bytes} of ${full} bytes`);
  const cached = join(dir('cache'));
  say(`checked at ${new Date(checkedAt).toISOString().slice(11, 19)}`);

  if (SCENARIO === 'onquit') {
    // A quit while something runs is just a quit: the downloaded update waits for the next one.
    await invoke(page, 'update:busy', true);
    const pid = runPid().pid;
    page.close();
    await quit();
    check('the old instance quit', !alive(pid));
    check('a quit while busy did not install the update', sha512(APP) === sha512(OLD));
    launch();
    await waitFor(() => runPid() && runPid().pid !== pid && alive(runPid().pid), 60_000, 'the instance to start again');
    page = await cdp();
    status = await invoke(page, 'update:check');
    status = await waitStatus(page, (x) => x.release.phase === 'downloaded', 60_000, 'the cached update');
    check('the next start finds the update again (already downloaded)', status.release.version === newVersion);
    const again = runPid().pid;
    page.close();
    await quit();
    check('the second instance quit', !alive(again));
    check('a normal quit with nothing running installed it', sha512(APP) === sha512(join(dir('feed'), newImage)));
    await sleep(3000);
    check('and did not start the app again', !runPid() || !alive(runPid().pid));
    return;
  }

  // what the person sees: the badge and the prompt in Hoje, then the section in Configurações
  await sleep(1500);
  await page.shot(join(WORK, 'hoje-badge.png')).catch(() => undefined);
  check('the restart prompt is shown', (await page.eval("document.querySelector('.upd-prompt')?.textContent ?? null")) !== null);
  await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Configurações')?.click()");
  await sleep(800);
  await page.eval("document.getElementById('updates')?.scrollIntoView({ block: 'start' })");
  await sleep(500);
  await page.shot(join(WORK, 'settings-updates.png')).catch(() => undefined);

  // never restart under a call or a ceremony without a yes
  await invoke(page, 'update:busy', true);
  let inst = await invoke(page, 'update:install', {});
  check('while busy, install is refused', inst.ok === false && inst.reason === 'busy', JSON.stringify(inst));
  status = await invoke(page, 'update:status');
  check('the downloaded update is still waiting', status.release.phase === 'downloaded' && status.busy === true);
  await invoke(page, 'update:busy', false);

  // the window is asked to save before the quit
  const before = runPid();
  inst = await invoke(page, 'update:install', {});
  check('install accepted when nothing is running', inst.ok === true, JSON.stringify(inst));
  page.close();
  await waitFor(() => !alive(before.pid), 40_000, 'the old instance to exit');
  check('the old instance exited', true);
  const next = await waitFor(() => {
    const r = runPid();
    return r && r.pid !== before.pid && alive(r.pid) ? r : null;
  }, 60_000, 'the new instance');
  check('the new instance started by itself, on the new version', next.version === newVersion, `pid ${next.pid}, version ${next.version}`);
  check('the installed AppImage is the served one (sha512)', sha512(APP) === sha512(join(dir('feed'), newImage)));
  check('and it is not the old one', sha512(APP) !== sha512(OLD));

  page = await cdp();
  const toast = await waitFor(() => page.eval(`document.querySelector('.upd-toast')?.textContent ?? null`), 40_000, 'the update toast');
  check('the toast says what it updated to', /0\.1\.1|Atualizado/.test(toast), toast);
  await page.shot(join(WORK, 'toast.png')).catch(() => undefined);
  const after = await invoke(page, 'update:status');
  check('the new instance reports itself current: no badge', after.badge === false && after.build.version === newVersion, `${after.build.version}/${after.release.phase}`);
  page.close();
  const log = readFileSync(appLog, 'utf8');
  check('the window state was saved before quitting (flush logged)', /\[update\] window state saved in \d+ ms/.test(log));
  void cached;
}

let failed = false;
try {
  await main();
} catch (e) {
  say(`ERROR ${e.stack ?? e}`);
  failed = true;
} finally {
  await quit().catch(() => undefined);
  server.kill();
}
const bad = results.filter((r) => !r.ok);
say(`${results.length - bad.length}/${results.length} checks passed${bad.length ? `; failed: ${bad.map((r) => r.name).join('; ')}` : ''}`);
process.exit(failed || bad.length ? 1 : 0);
