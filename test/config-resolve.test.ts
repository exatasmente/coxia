import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neutralConfig, newProvider } from '../src/shared/config/defaults';
import { applySettings, settingsFromConfig } from '../src/shared/config/settingsView';
import { NEUTRAL_WEB } from '../src/shared/settings';
import { locateSdk } from '../src/main/claudeSdk';
import { resolveConfig, resolveDocs } from '../src/main/config-resolve';
import { readProfileEnv, sdkEnv } from '../src/main/llm-core';
import { legacyConfigFixture } from './helpers/config';

const HOME = '/home/ana';
const ctx = { home: HOME, env: {} as NodeJS.ProcessEnv, fallbackCwd: '/data/ws' };

describe('getters for a migrated install: the constants env.ts used to hold', () => {
  const r = resolveConfig(legacyConfigFixture(), ctx);

  it('paths', () => {
    expect(r.projectsRoot).toBe('/home/ana/projects');
    expect(r.specsDir).toBe('/home/ana/projects/playbook/.specs');
    expect(r.cardSource?.command).toBe('/home/ana/.local/bin/cardtool');
    expect(r.cardSource?.reportArgs).toEqual(['report', '--format', 'json', '--dry-run']);
    expect(r.cardSource?.noteArgs).toEqual(['note', '{ref}', '{note}']);
    expect(r.cardSource?.stateFile).toBe('/home/ana/.local/share/cardtool/state.json');
    expect(r.cardSource?.historyFile).toBe('/home/ana/.local/share/cardtool/history.jsonl');
    expect(r.cardSource?.timeoutMs).toBe(150_000);
    expect(r.releaseSync).toEqual({ command: '/home/ana/projects/playbook/.claude/bin/release-sync', cwd: '/home/ana/projects/playbook', mirrorsDir: '/home/ana/.cache/release-sync' });
    expect(r.transcriptsDir).toBe('/home/ana/.claude/projects/-home-ana-projects');
    expect(r.cloneRoots).toEqual(['/home/ana/projects']);
    expect(r.claudeCli).toEqual({ command: 'claude-alt', cwd: '/home/ana/projects' });
    expect(r.terminal).toEqual({ command: 'gnome-terminal', args: ['--title', 'Coxia · Claude Code', '--'] });
    expect(r.timeExport?.command).toBe('/home/ana/.local/bin/timelog');
  });

  it('the seven repositories, in order', () => {
    expect(r.repos.map((x) => [x.id, x.path])).toEqual(
      ['web', 'web-ui', 'api', 'agent-ui', 'gateway', 'socket-hub', 'playbook'].map((n) => [n, `/home/ana/projects/${n}`]),
    );
  });

  it('host, issue project, QA user, refs and the release label', () => {
    expect(r.vcsHost).toBe('git.acme.test');
    expect(r.primaryVcs).toMatchObject({ kind: 'gitlab', cli: 'glab', apiUrl: 'https://git.acme.test/api/v4' });
    expect(r.issues).toEqual({ vcsId: 'gitlab', project: 'acme/web', projectId: 1, refPrefix: 'web#' });
    expect(r.qaUser).toBe('qa.acme');
    const m = r.releaseLabelPattern.exec('web-51.22.0');
    expect(m?.[1]).toBe('51.22.0');
    expect(r.releaseLabelPattern.test('other-1.0.0')).toBe(false);
  });

  it('the spec layout and the phase files of the SDD cycle', () => {
    expect(r.specLayout.phaseFiles[0]).toEqual({ file: 'ISSUE_COMPLETION.md', label: 'ISSUE_COMPLETION escrito' });
    expect(r.specLayout.phaseFiles.at(-1)).toEqual({ file: '0_BUG_REPORT.md', label: 'bug report escrito' });
    expect(r.specLayout.planFiles).toEqual(['2_PLAN.md', '3_PLAN.md']);
    expect(r.specLayout.gateFiles).toHaveLength(5);
    expect(r.specLayout.documents).toEqual({ gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' });
  });

  it('the specs folder can still be overridden from the environment, as before', () => {
    expect(resolveConfig(legacyConfigFixture(), { ...ctx, env: { CERIMONIAS_SPECS_DIR: '/tmp/specs', CERIMONIAS_TRANSCRIPTS_DIR: '/tmp/t', CERIMONIAS_CLONES_DIR: '/tmp/c' } })).toMatchObject({ specsDir: '/tmp/specs', transcriptsDir: '/tmp/t', cloneRoots: ['/tmp/c'] });
  });

  it('every role maps to OpenRouter on the SDK engine, with the old model strings', () => {
    expect(r.role('turn')).toMatchObject({ providerId: 'openrouter', engine: 'claude-sdk', kind: 'anthropic', model: 'deepseek/deepseek-v4.1-flash', baseUrl: 'https://openrouter.ai/api', secretRef: 'llm.openrouter', legacyCustomEndpoint: true, envFile: '/home/ana/.claude/openrouter.settings.json' });
    expect(r.role('deep').model).toBe('deepseek/deepseek-v4-pro-0813');
    expect(r.role('fix').model).toBe(r.role('reply').model);
  });
});

describe('getters for a fresh install: neutral, nothing from a company or a machine', () => {
  const r = resolveConfig(neutralConfig(), ctx);

  it('has no host, no repos, no QA user, no external tools', () => {
    expect(r.vcsHost).toBeNull();
    expect(r.primaryVcs).toBeNull();
    expect(r.repos).toEqual([]);
    expect(r.qaUser).toBeNull();
    expect(r.issues).toEqual({ vcsId: null, project: null, projectId: null, refPrefix: '' });
    expect(r.specsDir).toBeNull();
    expect(r.cardSource).toBeNull();
    expect(r.releaseSync).toBeNull();
    expect(r.timeExport).toBeNull();
    expect(r.specLayout.phaseFiles).toEqual([]);
    expect(r.stages).toEqual([]);
  });

  it('works in the workspace folder until a project root is configured, never in the home folder', () => {
    expect(r.projectsRoot).toBe('/data/ws');
    expect(r.claudeCli).toEqual({ command: 'claude', cwd: '/data/ws' });
    expect(r.terminal).toEqual({ command: null, args: [] });
    expect(r.transcriptsDir).toBe('/home/ana/.claude/projects/-data-ws');
  });

  it('serves every role from Anthropic through the SDK, with a key reference and no custom endpoint', () => {
    expect(r.role('turn')).toMatchObject({ providerId: 'anthropic', engine: 'claude-sdk', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', secretRef: 'llm.anthropic', legacyCustomEndpoint: false });
  });

  it('a role can point at another provider, and agents.roles can borrow another role\'s model', () => {
    const c = neutralConfig();
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', models: ['llama3'] }));
    c.llm.roles.deep = { provider: 'local', model: 'llama3' };
    c.agents.roles.teams.modelRole = 'deep';
    const x = resolveConfig(c, ctx);
    expect(x.role('deep')).toMatchObject({ providerId: 'local', engine: 'open', model: 'llama3', secretRef: null });
    expect(x.role('teams')).toMatchObject({ role: 'teams', modelRole: 'deep', providerId: 'local', model: 'llama3' });
    expect(x.role('turn').providerId).toBe('anthropic');
  });

  it('a configured root and repos resolve against the home folder', () => {
    const c = neutralConfig();
    c.projects.roots = ['~/work', '/srv/code'];
    c.projects.repos = [{ id: 'api', path: '~/work/api', remoteUrl: null, vcsId: null, projectPath: null }];
    c.vcs = [{ id: 'gh', kind: 'github', host: 'github.com', apiUrl: '', user: 'ana', secretRef: null, cliPreference: 'auto', cliCommand: null }];
    const x = resolveConfig(c, ctx);
    expect(x.projectsRoot).toBe('/home/ana/work');
    expect(x.cloneRoots).toEqual(['/home/ana/work', '/srv/code']);
    expect(x.repos[0].path).toBe('/home/ana/work/api');
    expect(x.primaryVcs).toMatchObject({ kind: 'github', cli: 'gh', apiUrl: 'https://api.github.com' });
  });
});

describe('the Settings view is derived from the config and applied back', () => {
  it('round-trips without losing what the view does not show', () => {
    const c = legacyConfigFixture();
    const s = settingsFromConfig(c, NEUTRAL_WEB);
    expect(s.models.turn).toBe('deepseek/deepseek-v4.1-flash');
    expect(s.modelOptions).toEqual(['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-pro-0813', 'qwen/qwen3.7-flash']);
    expect(s.tools).toEqual({ files: true, skills: true, gitlabMcp: true, glab: true, subagents: true });
    const back = applySettings(c, { ...s, models: { ...s.models, turn: 'qwen/qwen3.7-flash' }, notifications: false, language: 'en' });
    expect(back.llm.roles.turn).toEqual({ provider: 'openrouter', model: 'qwen/qwen3.7-flash' });
    expect(back.notifications).toBe(false);
    expect(back.language).toBe('en');
    expect(back.vcs).toEqual(c.vcs);
    expect(back.agents.tools.trackerMcpServer).toBe('tracker-issues');
    expect(back.voice.sttModel).toBe(c.voice.sttModel);
  });
});

describe('the environment of an SDK child, per provider kind', () => {
  const base = { PATH: '/bin', HOME: HOME, CLAUDE_CODE_ENTRYPOINT: 'cli', ANTHROPIC_BASE_URL: 'http://x', ANTHROPIC_API_KEY: 'ambient', CLAUDE_PID: '1' };
  const role = (c = legacyConfigFixture()) => resolveConfig(c, ctx).role('turn');

  it('legacy: exactly what agentEnv built (bearer token, empty API key, GITLAB_HOST, inherited Claude variables dropped)', () => {
    const env = sdkEnv({ target: role(), base, secret: 'KEY', profile: { FOO: 'bar' }, vcsHost: 'git.acme.test' });
    expect(env).toEqual({ PATH: '/bin', HOME, FOO: 'bar', ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: 'KEY', ANTHROPIC_API_KEY: '', GITLAB_HOST: 'git.acme.test' });
  });

  it('anthropic: the key goes in ANTHROPIC_API_KEY, nothing is inherited, no GITLAB_HOST without an integration', () => {
    const env = sdkEnv({ target: role(neutralConfig()), base, secret: 'KEY', profile: {}, vcsHost: null });
    expect(env).toMatchObject({ ANTHROPIC_API_KEY: 'KEY', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.GITLAB_HOST).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
  });

  it('anthropic without a stored key keeps only an API key the environment already has, never a session login', () => {
    const env = sdkEnv({ target: role(neutralConfig()), base, secret: null, profile: {}, vcsHost: null });
    expect(env.ANTHROPIC_API_KEY).toBe('ambient');
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
  });

  it('bedrock, vertex and foundry switch the SDK to the cloud and pass their options', () => {
    const c = neutralConfig();
    const mk = (kind: 'bedrock' | 'vertex' | 'foundry', options: Record<string, string>, secretRef: string | null = null) => {
      const x = neutralConfig();
      x.llm.providers = [newProvider({ id: 'cloud', kind, secretRef, options })];
      for (const k of Object.keys(x.llm.roles) as (keyof typeof x.llm.roles)[]) x.llm.roles[k] = { provider: 'cloud', model: 'm' };
      return resolveConfig(x, ctx).role('turn');
    };
    expect(sdkEnv({ target: mk('bedrock', { region: 'us-east-1', profile: 'dev' }), base, secret: null, profile: {}, vcsHost: null })).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1', AWS_PROFILE: 'dev' });
    expect(sdkEnv({ target: mk('vertex', { project: 'p', region: 'r' }), base, secret: null, profile: {}, vcsHost: null })).toMatchObject({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_PROJECT_ID: 'p', CLOUD_ML_REGION: 'r' });
    expect(sdkEnv({ target: mk('foundry', { resource: 'res' }, 'llm.f'), base, secret: 'K', profile: {}, vcsHost: null })).toMatchObject({ CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_FOUNDRY_RESOURCE: 'res', ANTHROPIC_FOUNDRY_API_KEY: 'K' });
    void c;
  });

  it('refuses an openai-compatible provider: that is the open engine\'s job', () => {
    const x = neutralConfig();
    x.llm.providers = [newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: 'http://localhost:1/v1' })];
    for (const k of Object.keys(x.llm.roles) as (keyof typeof x.llm.roles)[]) x.llm.roles[k] = { provider: 'local', model: 'm' };
    expect(() => sdkEnv({ target: resolveConfig(x, ctx).role('turn'), base, secret: null, profile: {}, vcsHost: null })).toThrow(/motor aberto/);
  });

  it('the env file of a provider contributes everything except keys and tokens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cerimonias-env-'));
    const file = join(dir, 'p.json');
    writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_MODEL: 'x', MY_API_KEY: 'secret', OTHER_TOKEN: 'secret', KEEP: '1' } }));
    expect(readProfileEnv(file)).toEqual({ ANTHROPIC_MODEL: 'x', KEEP: '1' });
    expect(readProfileEnv(join(dir, 'missing.json'))).toEqual({});
    expect(readProfileEnv(null)).toEqual({});
  });
});

describe('where the Claude SDK is loaded from', () => {
  const sdk = { installed: true, version: '1.0.0', path: '~/.coxia/sdk' };
  const files: Record<string, string> = {
    '/home/ana/.coxia/sdk/node_modules/@anthropic-ai/claude-agent-sdk/package.json': JSON.stringify({ exports: { '.': { import: './sdk.mjs', types: './sdk.d.ts' } } }),
    '/home/ana/.coxia/sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs': '',
  };
  const deps = (bundled: boolean, present = files) => ({ exists: (p: string) => p in present, read: (p: string) => present[p], bundled });

  it('prefers the user-local install when it is there', () => {
    expect(locateSdk(sdk, HOME, deps(true))).toEqual({ mode: 'local', root: '/home/ana/.coxia/sdk/node_modules/@anthropic-ai/claude-agent-sdk', entry: '/home/ana/.coxia/sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs' });
  });

  it('falls back to the bundled copy of an existing install, and says what is missing in a build without one', () => {
    expect(locateSdk({ installed: true, version: null, path: null }, HOME, deps(true))).toEqual({ mode: 'bundled' });
    expect(locateSdk(sdk, HOME, deps(true, {}))).toEqual({ mode: 'bundled' });
    const missing = locateSdk({ installed: false, version: null, path: null }, HOME, deps(false));
    expect(missing.mode).toBe('missing');
    expect(locateSdk(sdk, HOME, deps(false, {}))).toMatchObject({ mode: 'missing', reason: expect.stringContaining('/home/ana/.coxia/sdk') });
  });
});

describe('documentation sources', () => {
  it('lists what the config says and, with autoDetect, what Claude Code itself would load', () => {
    const home = mkdtempSync(join(tmpdir(), 'cerimonias-docs-'));
    const proj = join(home, 'work/app');
    for (const d of [join(home, '.claude/skills'), join(proj, '.claude/skills'), join(proj, '.claude/rules')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(proj, 'CLAUDE.md'), '#');
    writeFileSync(join(proj, '.mcp.json'), '{}');
    const c = neutralConfig();
    c.projects.repos = [{ id: 'app', path: proj, remoteUrl: null, vcsId: null, projectPath: null }];
    c.docs.knowledgeDirs = ['~/kb'];
    const exists = existsSync;
    const d = resolveDocs(c, { home, env: {}, fallbackCwd: home }, exists);
    expect(d.skillsDirs).toEqual([join(home, '.claude/skills'), join(proj, '.claude/skills')]);
    expect(d.rulesDirs).toEqual([join(proj, '.claude/rules')]);
    expect(d.claudeMdRoots).toEqual([proj]);
    expect(d.mcpConfigFiles).toEqual([join(proj, '.mcp.json')]);
    expect(d.knowledgeDirs).toEqual([join(home, 'kb')]);
    expect(d.detected).toContain(join(proj, '.mcp.json'));
    c.docs.autoDetect = false;
    expect(resolveDocs(c, { home, env: {}, fallbackCwd: home }, exists).skillsDirs).toEqual([]);
  });
});
