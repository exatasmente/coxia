import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { neutralConfig } from '../../src/shared/config';
import { flowOf, isTerminal, startRun } from '../../src/shared/runs';
import { createRunStore } from '../../src/main/runs-core';
import { gcmDecrypt, gcmEncrypt } from '../../src/main/masterKey';
import { createSecretsStore, type CryptoPort, type SecretsStore } from '../../src/main/secrets-core';
import { writeRegistry } from '../../src/main/workspaces-core';
import { agentFlowConfig, startInput } from './runs';

// A machine to move a workspace from, all in temp folders: a data root with a registry, one workspace with a configuration that refers to stored secrets, a command secret and an
// environment one, a clone of a local bare repository with a branch for an open run, and a secrets store sealed with its own key. No network and no real data.

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();

export const keyHex = (): string => randomBytes(32).toString('hex');

export function portFor(keyHexValue: string): CryptoPort {
  const key = Buffer.from(keyHexValue, 'hex');
  return { available: () => true, encrypt: (text) => gcmEncrypt(key, text), decrypt: (data) => gcmDecrypt(key, data) ?? ((): never => { throw new Error('wrong key'); })(), backend: () => null };
}

export function storeFor(root: string, key: string): SecretsStore {
  return createSecretsStore({ root, crypto: portFor(key), env: { COXIA_MOVE_TEST_ENV: 'env-value' }, home: '/nonexistent', now: () => new Date('2026-10-01T10:00:00Z'), run: () => '', exists: () => true });
}

export const SECRET_VALUES = { 'vcs.forge': 'forge-token-AAA111', 'llm.main': 'model-key-BBB222', 'plugin.demo.token': 'plugin-token-CCC333', 'test.llm-key': 'test-key-DDD444' } as const;

export interface Source {
  root: string;
  id: string;
  dir: string;
  key: string;
  store: SecretsStore;
  /** The clone the workspace points at, and the bare repository it came from. */
  clone: string;
  origin: string;
  /** The branch of the open run. */
  branch: string;
}

export function makeSource(base = mkdtempSync(join(tmpdir(), 'cerimonias-move-src-')), id = 'principal'): Source {
  const root = join(base, 'data');
  mkdirSync(root, { recursive: true });
  const key = keyHex();
  const dir = join(root, 'workspaces', id);
  mkdirSync(dir, { recursive: true });
  writeRegistry(root, { current: id, list: [{ id, name: 'Principal', createdAt: '2026-01-01T00:00:00.000Z', test: false }] });

  const origin = join(base, 'origin.git');
  const clone = join(base, 'repos', 'app');
  mkdirSync(join(base, 'repos'), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' });
  git(clone, 'config', 'user.name', 'Example Person');
  git(clone, 'config', 'user.email', 'person@example.com');
  git(clone, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(clone, 'README.md'), 'hello\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-q', '-m', 'first');
  git(clone, 'push', '-q', 'origin', 'main');
  const branch = 'cycle/123-some-title';
  git(clone, 'checkout', '-q', '-b', branch);
  writeFileSync(join(clone, 'work.txt'), 'in progress\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-q', '-m', 'work in progress');
  git(clone, 'checkout', '-q', 'main');
  git(clone, 'checkout', '-q', '-b', 'cycle/9-finished');
  git(clone, 'commit', '-q', '--allow-empty', '-m', 'done');
  git(clone, 'checkout', '-q', 'main');
  git(clone, 'remote', 'set-url', 'origin', 'git@example.com:group/project.git');

  const config = neutralConfig();
  config.projects.roots = [join(base, 'repos')];
  config.projects.repos = [{ id: 'app', path: clone, remoteUrl: 'git@example.com:group/project.git', vcsId: 'forge', projectPath: 'group/project' }];
  config.vcs = [{ id: 'forge', kind: 'github', host: 'example.com', apiUrl: '', user: 'person', secretRef: 'vcs.forge', cliPreference: 'auto', cliCommand: null } as never];
  config.llm.providers = [
    { id: 'main', kind: 'openai-compatible', engine: 'open', baseUrl: 'https://example.com/v1', models: [], secretRef: 'llm.main', envFile: null, options: {} } as never,
    { id: 'local', kind: 'openai-compatible', engine: 'open', baseUrl: 'http://localhost:11434/v1', models: [], secretRef: 'llm.local', envFile: null, options: {} } as never,
    { id: 'viaenv', kind: 'openai-compatible', engine: 'open', baseUrl: 'https://example.com/v2', models: [], secretRef: 'llm.fromenv', envFile: null, options: {} } as never,
  ];
  config.plugins.list = [{ id: 'demo', folder: null, enabled: false, allow: 'ask', settings: {} } as never];
  config.testEnvironment = { secrets: [{ ref: 'test.llm-key', testOnly: true }] } as never;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'acoes.json'), '{"actions":[]}');
  mkdirSync(join(dir, 'historico'), { recursive: true });
  writeFileSync(join(dir, 'historico', '2026-10-01.json'), '{"note":"kept"}');

  // What a move leaves out.
  writeFileSync(join(dir, 'owner.json'), '{"instanceId":"x"}');
  writeFileSync(join(dir, 'owner.lock'), '');
  writeFileSync(join(dir, 'stray.sock'), '');
  mkdirSync(join(dir, 'sandbox', 'copy'), { recursive: true });
  writeFileSync(join(dir, 'sandbox', 'copy', 'a.txt'), 'x');
  mkdirSync(join(dir, 'browser', 'agent'), { recursive: true });
  writeFileSync(join(dir, 'browser', 'agent', 'Cookies'), 'cookie-jar');

  // One run still going on the branch with work, one finished.
  const store = createRunStore(join(dir, 'runs'));
  const flow = flowOf(agentFlowConfig());
  store.create(startRun(startInput({ id: 'r-open01-aaaa', branch, worktree: join(base, 'wt1') }), flow, '2026-10-03T10:00:00.000Z').run);
  const finished = startRun(startInput({ id: 'r-done01-bbbb', issue: { ref: 'app#9', iid: 9, title: 'Done', url: 'https://example.com/group/project/issues/9' }, branch: 'cycle/9-finished', worktree: join(base, 'wt2') }), flow, '2026-10-03T10:00:00.000Z').run;
  store.create({ ...finished, status: 'cancelled' });
  if (isTerminal(store.get('r-done01-bbbb') ?? finished) === false) throw new Error('the finished run must be terminal');

  const secrets = storeFor(root, key);
  for (const [ref, value] of Object.entries(SECRET_VALUES)) secrets.set({ ref, source: 'stored', value });
  secrets.set({ ref: 'llm.local', source: 'command', command: '/usr/bin/true' });
  secrets.set({ ref: 'llm.fromenv', source: 'env', name: 'COXIA_MOVE_TEST_ENV' });
  // A secret no configuration refers to stays out of the bundle.
  secrets.set({ ref: 'unrelated.secret', source: 'stored', value: 'unrelated-value-EEE555' });
  return { root, id, dir, key, store: secrets, clone, origin, branch };
}
