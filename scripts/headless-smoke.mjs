// Runs the built headless bundle once against a throw-away data folder and key: it must come up, answer /healthz, and leave with 0 on SIGTERM.
// Needs `npm run build:headless` first. Nothing here leaves 127.0.0.1.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../out/headless/coxia.mjs', import.meta.url));
if (!existsSync(bundle)) {
  console.error('headless-smoke: out/headless/coxia.mjs is missing; run `npm run build:headless` first');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'coxia-headless-smoke-'));
const data = join(dir, 'data');
mkdirSync(data);
const key = join(dir, 'master.key');
writeFileSync(key, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });

const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));

const child = spawn(process.execPath, [bundle, '--data-dir', data, '--master-key-file', key, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', (c) => (output += c));
child.stderr.on('data', (c) => (output += c));
const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));

const health = () =>
  new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/cerimonias/healthz' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('error', fail);
    req.end();
  });

let failure = null;
try {
  let answer = null;
  for (let i = 0; i < 100 && !answer; i++) {
    answer = await health().catch(() => null);
    if (!answer) await new Promise((r) => setTimeout(r, 100));
  }
  if (!answer || answer.status !== 200 || JSON.parse(answer.body).ok !== true) throw new Error(`no healthy answer: ${JSON.stringify(answer)}`);
  console.log(`headless-smoke: /healthz ${answer.body}`);
  child.kill('SIGTERM');
  const end = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 15_000))]);
  if (end === 'timeout' || end.code !== 0) throw new Error(`did not exit 0 on SIGTERM: ${JSON.stringify(end)}`);
  console.log('headless-smoke: exited 0 on SIGTERM');
} catch (e) {
  failure = e;
  child.kill('SIGKILL');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failure) {
  console.error(`headless-smoke: ${failure.message}\n${output}`);
  process.exit(1);
}
