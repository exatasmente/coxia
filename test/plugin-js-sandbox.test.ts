import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSandboxService } from '../src/main/sandbox';
import { probeSandbox } from '../src/main/sandbox/probe';
import { neutralSandbox } from '../src/shared/config/defaults';
import { runJsPlugin, type JsCall } from '../src/main/plugins/runtime';

// A JavaScript plugin in a real sandbox, run by the Electron executable in Node mode, as the app does: it reads the cycle folder, asks for a request the
// app answers between rounds, imports a module of its own folder, asks for a write and leaves a document. Skipped where this machine has no sandbox.

// The tests stub `electron` (vitest.config.ts), so the binary is found through the package's own path file.
const electronDir = join(createRequire(import.meta.url).resolve('electron/package.json'), '..');
const pathFile = join(electronDir, 'path.txt');
const executable = existsSync(pathFile) ? realpathSync(join(electronDir, 'dist', readFileSync(pathFile, 'utf8').trim())) : '';

const status = await probeSandbox();
const maybe = status.available && executable ? describe : describe.skip;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'coxia-plugin-js-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

maybe('a JavaScript plugin in a real sandbox', () => {
  it('replays its request, reads the cycle folder, imports its own module and leaves its document and its write', async () => {
    const wt = join(root, 'wt');
    mkdirSync(join(wt, 'docs/cycles/1-x'), { recursive: true });
    writeFileSync(join(wt, 'docs/cycles/1-x/SEARCH_REQUESTS.md'), 'what is a plugin\n');
    const sandbox = createSandboxService({ dir: join(root, 'sandbox'), protect: [join(root, 'data')] });
    const files = {
      'index.mjs': "import { fmt } from './lib/fmt.mjs';\nexport default async (ctx) => { const q = (await ctx.readCycleFile('SEARCH_REQUESTS.md')).trim(); const r = await ctx.request('search', { query: { q } }); ctx.write('post', { body: { q } }); return { document: fmt(q, r.body, ctx.round) }; };",
      'lib/fmt.mjs': "export const fmt = (q, b, n) => 'Q=' + q + ' B=' + b + ' R=' + n;",
    };
    const asked: JsCall[] = [];
    const out = await runJsPlugin(
      { sandbox, config: neutralSandbox(), executable, read: async (call) => (asked.push(call), { id: call.id, status: 200, contentType: 'application/json', body: '{"results":1}', truncated: false }) },
      { id: 'web-search', files, entry: 'index.mjs', settings: {}, documents: [{ name: '7_WEB_SEARCH.md', label: 'Web', title: 'Web' }] },
      'stage-finished',
      { issue: 1 },
      { worktree: wt, cycleFolder: 'docs/cycles/1-x' },
    );
    expect(out.ok).toBe(true);
    expect(asked).toEqual([{ id: 'search', query: { q: 'what is a plugin' } }]);
    expect(out.writes).toEqual([{ id: 'post', body: '{"q":"what is a plugin"}' }]);
    expect(readFileSync(join(wt, 'docs/cycles/1-x/7_WEB_SEARCH.md'), 'utf8')).toContain('Q=what is a plugin B={"results":1} R=2');
  }, 120_000);

  it('carries what a call from a conversation asked, the conversation and the run in the context', async () => {
    const wt = join(root, 'wt3');
    mkdirSync(join(wt, 'docs/cycles/1-x'), { recursive: true });
    const sandbox = createSandboxService({ dir: join(root, 'sandbox3'), protect: [join(root, 'data')] });
    const files = { 'index.mjs': "export default async (ctx) => ({ document: ctx.event + ' ' + JSON.stringify([ctx.asked, ctx.thread, ctx.runId]) });" };
    const listen = { sandbox, config: neutralSandbox(), executable, read: async (call: JsCall) => ({ id: call.id, refused: 'no' as const }) };
    const asked = await runJsPlugin(listen, { id: 'asked', files, entry: 'index.mjs', settings: {} }, 'conversation-called', { issue: 123, stage: 'implement', asked: 'how does replay work?', thread: 'run-r1', runId: 'r1' }, { worktree: wt, cycleFolder: 'docs/cycles/1-x' });
    expect(asked.ok).toBe(true);
    expect(asked.text).toBe('conversation-called ["how does replay work?","run-r1","r1"]');
    // On the four events of a cycle the three fields are null.
    const cycle = await runJsPlugin(listen, { id: 'cycle', files, entry: 'index.mjs', settings: {} }, 'stage-finished', { issue: 1 }, { worktree: wt, cycleFolder: 'docs/cycles/1-x' });
    expect(cycle.text).toBe('stage-finished [null,null,null]');
  }, 120_000);

  it('says why a plugin that throws failed, and writes nothing', async () => {
    const wt = join(root, 'wt2');
    mkdirSync(join(wt, 'docs/cycles/1-x'), { recursive: true });
    const sandbox = createSandboxService({ dir: join(root, 'sandbox2'), protect: [join(root, 'data')] });
    const out = await runJsPlugin(
      { sandbox, config: neutralSandbox(), executable, read: async (call) => ({ id: call.id, refused: 'no' }) },
      { id: 'broken', files: { 'index.mjs': "export default async () => { throw new Error('it broke'); };" }, entry: 'index.mjs', settings: {}, documents: [{ name: '7_X.md', label: 'X', title: 'X' }] },
      'stage-finished',
      { issue: 1 },
      { worktree: wt, cycleFolder: 'docs/cycles/1-x' },
    );
    expect(out.ok).toBe(false);
    expect(out.refused).toContain('it broke');
    expect(existsSync(join(wt, 'docs/cycles/1-x/7_X.md'))).toBe(false);
  }, 120_000);
});
