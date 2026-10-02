import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyDocs, firstParagraph, proposeDocs, scanProject, scanUser, scanWorkspace, targetsOf } from '../src/main/agentPrep-core';
import { neutralConfig } from '../src/shared/config';
import { createTranslator } from '../src/shared/i18n';
import { calls, installFakeEngine } from './helpers/promptCapture';

const tr = createTranslator('en');

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

let home: string;
let work: string;

// A small machine: ~/.claude, a workspace folder with three repos, and one folder that does not exist.
beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'agent-prep-'));
  home = join(base, 'home');
  work = join(home, 'work');

  write(join(home, '.claude/CLAUDE.md'), '# Me\n\nPersonal rules.\n');
  write(join(home, '.claude/skills/commit/SKILL.md'), '# commit\n');
  write(join(home, '.claude/agents/planner.md'), '# planner\n');
  write(join(home, '.claude/commands/ship.md'), '# ship\n');
  // Things that must never be read.
  write(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { token: 'sk-user-secret-0001' } }));
  write(join(home, '.claude/settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-settings-secret-0002' } }));

  const api = join(work, 'api');
  mkdirSync(join(api, '.git'), { recursive: true });
  write(join(api, 'CLAUDE.md'), '# API\n\n> Quote first.\n\n```\ncode\n```\n\nOrders service for the shop: an HTTP API over Postgres. It owns checkout and invoices, and nothing else.\n\n## Rules\n- thin controllers\n');
  write(join(api, 'package.json'), JSON.stringify({ name: 'shop-api', description: 'Orders API', dependencies: { express: '^5' }, devDependencies: { typescript: '^5', vitest: '^3' } }));
  write(join(api, '.env'), 'DATABASE_URL=postgres://user:pass-from-env-file@db/x\n');
  write(join(api, '.claude/skills/deploy/SKILL.md'), '# deploy\n');
  write(join(api, '.claude/skills/migrate/SKILL.md'), '# migrate\n');
  write(join(api, '.claude/skills/notes.txt'), 'not a skill');
  mkdirSync(join(api, '.claude/skills/empty'), { recursive: true });
  write(join(api, '.claude/rules/style.md'), '# style\n');
  write(join(api, '.claude/rules/db/naming.md'), '# naming\n');
  write(join(api, '.claude/agents/reviewer.md'), '# reviewer\n');
  write(join(api, '.claude/knowledge-base/billing.md'), '# billing\n');
  write(join(api, '.mcp.json'), JSON.stringify({ mcpServers: { tracker: { command: 'node', args: ['t.js'], env: { TRACKER_TOKEN: 'tok-mcp-secret-0003' } }, docs: { command: 'npx' } } }));
  write(join(api, '.specs/#101-checkout/bug/0_BUG_REPORT.md'), '# bug\n');
  write(join(api, '.specs/#102-invoice/feat/0_RFC.md'), '# rfc\n');
  write(join(api, '.specs/README.md'), '# specs\n');

  const web = join(work, 'web');
  mkdirSync(join(web, '.git'), { recursive: true });
  write(join(web, 'README.md'), '# Web\n\nThe storefront of the shop. A single page app that talks to the API.\n');
  write(join(web, 'package.json'), JSON.stringify({ name: 'shop-web', dependencies: { react: '^19', vite: '^7' } }));
  write(join(web, 'docs/architecture.md'), '# architecture\n');

  const tools = join(work, 'tools');
  mkdirSync(join(tools, '.git'), { recursive: true });
  write(join(tools, 'Makefile'), 'all:\n');
  // A repo that is a symlink to a folder elsewhere: the claude folders of a team playbook are often linked in.
  const playbook = join(home, 'playbook');
  write(join(playbook, '.claude/skills/review/SKILL.md'), '# review\n');
  mkdirSync(join(tools, '.claude'), { recursive: true });
  symlinkSync(join(playbook, '.claude/skills'), join(tools, '.claude/skills'));

  // A python service and a php one, for the stack detection.
  const py = join(work, 'ml');
  mkdirSync(join(py, '.git'), { recursive: true });
  write(join(py, 'pyproject.toml'), '[project]\nname = "ml-service"\ndependencies = ["fastapi", "numpy"]\n');
  const php = join(work, 'legacy');
  mkdirSync(join(php, '.git'), { recursive: true });
  write(join(php, 'composer.json'), JSON.stringify({ name: 'acme/legacy', require: { 'laravel/framework': '^7' } }));
  mkdirSync(join(work, 'node_modules/dep/.git'), { recursive: true });
});

describe('scanning one project', () => {
  it('lists what an agent can use as context, with counts and names', () => {
    const p = scanProject({ id: 'api', path: join(work, 'api') }, tr);
    expect(p.exists).toBe(true);
    expect(p.isGitRepo).toBe(true);
    expect(p.name).toBe('shop-api');
    expect(p.claudeMd).toBe(join(work, 'api/CLAUDE.md'));
    // Only a folder with a SKILL.md is a skill.
    expect(p.skills).toEqual({ dir: join(work, 'api/.claude/skills'), count: 2, names: ['deploy', 'migrate'] });
    expect(p.rules?.count).toBe(2);
    expect(p.agents).toMatchObject({ count: 1, names: ['reviewer'] });
    expect(p.knowledge?.dir).toBe(join(work, 'api/.claude/knowledge-base'));
    expect(p.specsDir).toMatchObject({ dir: join(work, 'api/.specs'), count: 2, names: ['#101-checkout', '#102-invoice'] });
    expect(p.mcpConfig).toBe(join(work, 'api/.mcp.json'));
    expect(p.mcpServers).toEqual(['docs', 'tracker']);
  });

  it('recognises the stack from the manifests', () => {
    expect(scanProject({ id: 'api', path: join(work, 'api') }, tr).stack).toEqual(['Node.js', 'Express', 'TypeScript']);
    expect(scanProject({ id: 'web', path: join(work, 'web') }, tr).stack).toEqual(['Node.js', 'React', 'Vite']);
    expect(scanProject({ id: 'ml', path: join(work, 'ml') }, tr).stack).toEqual(['Python', 'FastAPI']);
    expect(scanProject({ id: 'ml', path: join(work, 'ml') }, tr).name).toBe('ml-service');
    expect(scanProject({ id: 'legacy', path: join(work, 'legacy') }, tr).stack).toEqual(['PHP', 'Laravel']);
  });

  it('writes a short summary from the facts, with no model: the purpose from CLAUDE.md, else the README', () => {
    const api = scanProject({ id: 'api', path: join(work, 'api') }, tr);
    expect(api.purpose).toBe('Orders service for the shop: an HTTP API over Postgres. It owns checkout and invoices, and nothing else.');
    expect(api.summary).toBe('Orders service for the shop: an HTTP API over Postgres. It owns checkout and invoices, and nothing else. Stack: Node.js, Express, TypeScript. Context for agents: CLAUDE.md, 2 skills, 2 rules, 1 agent, 1 knowledge document, 2 MCP servers.');
    const web = scanProject({ id: 'web', path: join(work, 'web') }, tr);
    expect(web.purpose).toBe('The storefront of the shop. A single page app that talks to the API.');
    expect(web.summary).toContain('No context for agents');
    expect(scanProject({ id: 'tools', path: join(work, 'tools') }, tr).skills?.count).toBe(1);
  });

  it('follows a link to a skills folder, and reports a folder that is not there', () => {
    expect(scanProject({ id: 'tools', path: join(work, 'tools') }, tr).skills?.names).toEqual(['review']);
    const gone = scanProject({ id: 'ghost', path: join(work, 'ghost') }, tr);
    expect(gone.exists).toBe(false);
    expect(gone.summary).toBe('The folder does not exist on this machine.');
  });

  it('never puts a secret in the result: not the .env, not the MCP settings, not the user files', () => {
    const scan = scanWorkspace([{ id: 'api', path: join(work, 'api') }], home, 'en');
    const text = JSON.stringify(scan);
    for (const secret of ['pass-from-env-file', 'tok-mcp-secret-0003', 'sk-user-secret-0001', 'sk-settings-secret-0002', 'TRACKER_TOKEN', 'DATABASE_URL']) expect(text).not.toContain(secret);
  });

  it('reads the user folder: CLAUDE.md, skills, agents and commands', () => {
    const u = scanUser(home);
    expect(u.claudeMd).toBe(join(home, '.claude/CLAUDE.md'));
    expect(u.skills?.names).toEqual(['commit']);
    expect(u.agents?.names).toEqual(['planner']);
    expect(u.commands?.names).toEqual(['ship']);
    expect(scanUser(join(home, 'nowhere'))).toEqual({ claudeMd: null, skills: null, agents: null, commands: null });
  });
});

describe('the first paragraph of a document', () => {
  it('skips headings, quotes, code, lists, tables, images and import lines', () => {
    expect(firstParagraph('# T\n\n> q\n\n@file\n\n- a\n\n| a | b |\n\n![x](y)\n\n```\nnot this\n```\n\nThe real text.\n\nSecond.')).toBe('The real text.');
    expect(firstParagraph('# only a title\n')).toBe('');
  });

  it('cuts a long paragraph at a sentence', () => {
    const long = `${'First sentence is here and it is rather long to begin with, so it fills the room. '.repeat(1)}${'Second sentence goes on and on without any end in sight at all. '.repeat(6)}`;
    const out = firstParagraph(long, 120);
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith('.')).toBe(true);
  });
});

describe('which folders a workspace scans', () => {
  it('takes the repos it lists, the roots that carry context, and the git repos directly under a root', () => {
    const c = neutralConfig();
    c.projects.roots = [work];
    c.projects.repos = [{ id: 'listed', path: join(work, 'api'), remoteUrl: null, vcsId: null, projectPath: null }];
    const targets = targetsOf(c, home);
    expect(targets.map((t) => t.id).sort()).toEqual(['legacy', 'listed', 'ml', 'tools', 'web']);
    // node_modules is never walked, a root with nothing for agents is not a project, and a repo listed twice is scanned once.
    expect(targets.find((t) => t.path === join(work, 'api'))?.id).toBe('listed');
  });

  it('adds a root of its own when it has a CLAUDE.md, and skips auto discovery when it is off', () => {
    write(join(work, 'CLAUDE.md'), '# Workspace\n\nShared rules.\n');
    const c = neutralConfig();
    c.projects.roots = [work];
    c.projects.autoDiscover = false;
    expect(targetsOf(c, home).map((t) => t.id)).toEqual(['work']);
  });

  it('expands ~ in the paths of the config', () => {
    const c = neutralConfig();
    c.projects.repos = [{ id: 'api', path: '~/work/api', remoteUrl: null, vcsId: null, projectPath: null }];
    c.projects.roots = [];
    expect(targetsOf(c, home)).toEqual([{ id: 'api', path: join(home, 'work/api') }]);
  });
});

describe('the docs the scan proposes', () => {
  const scan = () => {
    const c = neutralConfig();
    c.projects.roots = [work];
    return scanWorkspace(targetsOf(c, home), home, 'en');
  };

  it('lists every folder it found, with ~ for the home, the user folder included', () => {
    const { docs } = proposeDocs(scan(), null, home, 'en');
    expect(docs.claudeMdRoots).toEqual(expect.arrayContaining(['~/work', '~/work/api', '~/.claude']));
    expect(docs.skillsDirs).toEqual(expect.arrayContaining(['~/work/api/.claude/skills', '~/work/tools/.claude/skills', '~/.claude/skills']));
    expect(docs.rulesDirs).toEqual(['~/work/api/.claude/rules']);
    expect(docs.agentsDirs).toEqual(expect.arrayContaining(['~/work/api/.claude/agents', '~/.claude/agents']));
    expect(docs.knowledgeDirs).toEqual(['~/work/api/.claude/knowledge-base']);
    expect(docs.mcpConfigFiles).toEqual(['~/work/api/.mcp.json']);
    expect(docs.specsDir).toBe('~/work/api/.specs');
  });

  it('keeps what the workspace already lists first, and adds each path once', () => {
    const c = neutralConfig();
    c.docs.skillsDirs = ['~/mine/skills', '~/work/api/.claude/skills'];
    c.docs.specsDir = '~/mine/specs';
    const { docs } = proposeDocs(scan(), c.docs, home, 'en');
    expect(docs.skillsDirs.slice(0, 2)).toEqual(['~/mine/skills', '~/work/api/.claude/skills']);
    expect(docs.skillsDirs.filter((p) => p === '~/work/api/.claude/skills')).toHaveLength(1);
    expect(docs.specsDir).toBe('~/mine/specs');
  });

  it('explains what it left out: a docs folder, a missing folder, the MCP names, the specs folder', () => {
    const c = neutralConfig();
    c.projects.roots = [work];
    c.projects.repos = [{ id: 'ghost', path: join(work, 'ghost'), remoteUrl: null, vcsId: null, projectPath: null }];
    const { notes, docs } = proposeDocs(scanWorkspace(targetsOf(c, home), home, 'en'), null, home, 'en');
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Project web has a docs/ folder with 1 text file'),
        expect.stringContaining('The folder ~/work/ghost does not exist here'),
        expect.stringContaining('A specs folder was found at ~/work/api/.specs (2 issues)'),
        expect.stringContaining('(servers: docs, tracker); only the names were read'),
      ]),
    );
    expect(docs.knowledgeDirs.some((d) => d.endsWith('/docs'))).toBe(false);
  });

  it('writes the notes in Portuguese for a Portuguese workspace', () => {
    const c = neutralConfig();
    c.projects.roots = [work];
    const pt = proposeDocs(scanWorkspace(targetsOf(c, home), home, 'pt-BR'), null, home, 'pt-BR');
    expect(pt.notes.join('\n')).toContain('tem uma pasta docs/ com 1 arquivo de texto');
    expect(scanWorkspace(targetsOf(c, home), home, 'pt-BR').projects.find((p) => p.id === 'api')?.summary).toContain('Contexto para agentes: CLAUDE.md, 2 skills, 2 regras, 1 agente');
  });

  it('applies the proposal to the docs section of a config and leaves the rest alone', () => {
    const c = neutralConfig();
    c.docs.autoDetect = false;
    const { docs } = proposeDocs(scan(), null, home, 'en');
    const next = applyDocs(c, docs);
    expect(next.docs.skillsDirs).toEqual(docs.skillsDirs);
    expect(next.docs.autoDetect).toBe(false);
    expect({ ...next, docs: null }).toEqual({ ...c, docs: null });
  });
});

describe('the optional model summary', () => {
  it('is one call to the cheap role with the facts of the scan, and fills modelSummary', async () => {
    await installFakeEngine();
    const { registerEngine } = await import('../src/main/engine/registry');
    let prompt = '';
    registerEngine('claude-sdk', (async (req: { prompt: string; role: string }) => {
      prompt = req.prompt;
      calls.push({ role: req.role, prompt: req.prompt, system: '', maxTurns: null, resume: null, allowedTools: [], extraDirs: [], schemaKeys: [] });
      return { data: { resumos: [{ id: 'api', resumo: 'Orders API with its own skills.' }] }, sessionId: 's', sources: [] };
    }) as never);
    const { summarizeScan, canSummarize } = await import('../src/main/agentPrep');
    const { secrets } = await import('../src/main/secrets');
    // A fresh install has no key for the default provider: no model is called.
    expect(canSummarize()).toBe(false);
    await expect(summarizeScan(scanWorkspace([{ id: 'api', path: join(work, 'api') }], home, 'en'))).rejects.toThrow(/nenhum provedor/);
    process.env.COXIA_PREP_KEY = 'not-a-real-key';
    secrets().set({ ref: 'llm.anthropic', source: 'env', name: 'COXIA_PREP_KEY' });
    expect(canSummarize()).toBe(true);
    const before = calls.length;
    const out = await summarizeScan(scanWorkspace([{ id: 'api', path: join(work, 'api') }, { id: 'ghost', path: join(work, 'ghost') }], home, 'en'));
    expect(calls.length - before).toBe(1);
    expect(calls[calls.length - 1].role).toBe('teams');
    expect(out.projects.find((p) => p.id === 'api')?.modelSummary).toBe('Orders API with its own skills.');
    expect(out.projects.find((p) => p.id === 'ghost')?.modelSummary).toBeUndefined();
    // The model gets facts, never the text of a file: no secret and no CLAUDE.md body.
    expect(prompt).toContain('"id":"api"');
    expect(prompt).not.toContain('pass-from-env-file');
    expect(prompt).not.toContain('tok-mcp-secret-0003');
  });
});
