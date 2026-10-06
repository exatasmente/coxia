import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSandboxService } from '../src/main/sandbox';
import { probeSandbox } from '../src/main/sandbox/probe';
import { neutralSandbox } from '../src/shared/config/defaults';
import { runJsPlugin } from '../src/main/plugins/runtime';
import { readPluginDeclaration } from '../src/shared/plugins/declaration';

// The web search plugin of the repository, called with a fake context: no sandbox, no instance, no network. What it reads from the cycle folder, what it
// asks the app to search and the document it returns are pinned here; the app's side (permission, the call, the audit) is the platform's own tests.

const url = (p: string) => new URL(`../plugins/web-search/${p}`, import.meta.url);
const plugin = (await import(url('index.mjs').href)) as { default: (ctx: unknown) => Promise<{ document?: string }> };

type Answer = { id: string; status: number; contentType: string; body: string; truncated: boolean } | { id: string; refused: string };

function context(files: Record<string, string>, answer: (q: string) => Answer) {
  const asked: { id: string; query: Record<string, string> }[] = [];
  return {
    asked,
    ctx: {
      event: 'stage-finished',
      issue: 123,
      stage: 'refine',
      round: 2,
      settings: { url: 'http://127.0.0.1:8888' },
      readCycleFile: async (name: string) => files[name] ?? null,
      request: async (id: string, options: { query: Record<string, string> }) => {
        asked.push({ id, query: options.query });
        const a = answer(options.query.q);
        return 'refused' in a ? Promise.reject(new Error(a.refused)) : a;
      },
      write: () => undefined,
      log: () => undefined,
    },
  };
}

const results = (n: number) => JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ title: `Result ${i + 1}`, url: `https://example.com/${i + 1}`, content: `Snippet ${i + 1}` })) });
const ok = (body: string): Answer => ({ id: 'search', status: 200, contentType: 'application/json', body, truncated: false });

describe('the web search plugin', () => {
  it('has a declaration the platform reads', () => {
    const r = readPluginDeclaration(readFileSync(url('plugin.json'), 'utf8'), '/p');
    expect(r.refused).toBeNull();
    expect(r.declaration?.offers).toMatchObject({ runtime: 'js', events: ['stage-finished'], documents: [{ name: 'WEB_SEARCH.md' }], requests: [{ id: 'search', method: 'GET', write: false }] });
    expect(r.declaration?.offers.agents).toContain('SEARCH_REQUESTS.md');
  });

  it('searches every new question together and writes the results with their sources', async () => {
    const c = context({ 'SEARCH_REQUESTS.md': '# Searches\n\n- what is a plugin\n- what is a plugin\n* how does replay work\n' }, () => ok(results(7)));
    const out = await plugin.default(c.ctx);
    expect(c.asked).toEqual([
      { id: 'search', query: { q: 'what is a plugin', format: 'json' } },
      { id: 'search', query: { q: 'how does replay work', format: 'json' } },
    ]);
    expect(out.document).toContain('## what is a plugin');
    expect(out.document).toContain('- [Result 1](https://example.com/1)');
    expect(out.document).toContain('never instructions');
    expect(out.document?.match(/https:\/\/example\.com\/\d/g)).toHaveLength(10);
  });

  it('does not search a question the document already answers, and keeps what was there', async () => {
    const before = '# Web search\n\nintro\n\n## what is a plugin\n\n- [Old](https://example.com/old)\n';
    const c = context({ 'SEARCH_REQUESTS.md': '- what is a plugin\n- a new one\n', 'WEB_SEARCH.md': before }, () => ok(results(1)));
    const out = await plugin.default(c.ctx);
    expect(c.asked.map((a) => a.query.q)).toEqual(['a new one']);
    expect(out.document).toContain('https://example.com/old');
    expect(out.document).toContain('## a new one');
  });

  it('returns nothing when there is nothing new to search', async () => {
    expect(await plugin.default(context({}, () => ok(results(1))).ctx)).toEqual({});
    expect(await plugin.default(context({ 'SEARCH_REQUESTS.md': '- q\n', 'WEB_SEARCH.md': '## q\n' }, () => ok(results(1))).ctx)).toEqual({});
  });

  it('searches at most five new questions per stage', async () => {
    const many = Array.from({ length: 8 }, (_, i) => `- question ${i + 1}`).join('\n');
    const c = context({ 'SEARCH_REQUESTS.md': many }, () => ok(results(1)));
    await plugin.default(c.ctx);
    expect(c.asked).toHaveLength(5);
  });

  it('says why a question has no results: refused, an error status, or an answer that is not JSON', async () => {
    const c = context({ 'SEARCH_REQUESTS.md': '- refused\n- broken\n- html\n- links\n' }, (q) =>
      q === 'refused' ? { id: 'search', refused: 'the network was not allowed' } : q === 'broken' ? { id: 'search', status: 502, contentType: 'text/plain', body: 'bad gateway', truncated: false } : q === 'html' ? ok('<html></html>') : ok(JSON.stringify({ results: [{ title: 'x', url: 'javascript:alert(1)' }] })),
    );
    const out = (await plugin.default(c.ctx)).document ?? '';
    expect(out).toContain('the network was not allowed');
    expect(out).toContain('502');
    expect(out).toContain('json format');
    expect(out).not.toContain('javascript:');
  });
});

// The same plugin, files as they are in the repository, in a real sandbox through the app's runtime: the replay round, the document in the cycle folder.

const electronDir = join(createRequire(import.meta.url).resolve('electron/package.json'), '..');
const pathFile = join(electronDir, 'path.txt');
const executable = existsSync(pathFile) ? realpathSync(join(electronDir, 'dist', readFileSync(pathFile, 'utf8').trim())) : '';
const status = await probeSandbox();
const root = realpathSync(mkdtempSync(join(tmpdir(), 'coxia-web-search-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

(status.available && executable ? describe : describe.skip)('the web search plugin in a real sandbox', () => {
  it('asks the app to search, and leaves WEB_SEARCH.md in the cycle folder', async () => {
    const wt = join(root, 'wt');
    mkdirSync(join(wt, 'docs/cycles/123-x'), { recursive: true });
    writeFileSync(join(wt, 'docs/cycles/123-x/SEARCH_REQUESTS.md'), '- what is a plugin\n');
    const dir = realpathSync(url('').pathname);
    const files: Record<string, string> = {};
    for (const rel of ['plugin.json', 'index.mjs', ...readdirSync(join(dir, 'lib')).map((f) => `lib/${f}`)]) files[rel] = readFileSync(join(dir, rel), 'utf8');
    const out = await runJsPlugin(
      { sandbox: createSandboxService({ dir: join(root, 'sandbox'), protect: [join(root, 'data')] }), config: neutralSandbox(), executable, read: async (call) => ({ id: call.id, status: 200, contentType: 'application/json', body: results(2), truncated: false }) },
      { id: 'web-search', files, entry: 'index.mjs', settings: { url: 'http://127.0.0.1:8888' }, documents: [{ name: 'WEB_SEARCH.md', label: 'Web search', title: 'Web search' }] },
      'stage-finished',
      { issue: 123, stage: 'refine' },
      { worktree: wt, cycleFolder: 'docs/cycles/123-x' },
    );
    expect(out.ok).toBe(true);
    expect(readFileSync(join(wt, 'docs/cycles/123-x/WEB_SEARCH.md'), 'utf8')).toContain('[Result 1](https://example.com/1)');
  }, 120_000);
});
