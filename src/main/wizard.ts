import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { BrowserWindow, app, dialog } from 'electron';
import { expandHome, shrinkHome } from '../shared/config/paths';
import type { LlmProvider, VcsIntegration } from '../shared/config/types';
import { getLanguage } from '../shared/i18n';
import {
  type CycleTemplatesResult,
  type DocsFound,
  type DocsScanResult,
  type FolderPick,
  type ProviderTestResult,
  SDK_EVENT,
  type ScannedRepo,
  type SdkEvent,
  type SdkStatus,
  type VcsTestResult,
  type VoiceAction,
  type VoiceRunResult,
  WIZARD_CHANNELS as C,
  type WizardAvailability,
  type WizardProgress,
  DOCS_KEYS,
} from '../shared/wizard';
import { locateSdk, loadClaudeQuery, claudeExecutable } from './claudeSdk';
import { probeOpenAIProvider } from './engine/open';
import { ATAS, DATA_ROOT, HOME } from './env';
import { listCycleTemplates, prepareAgents } from './cycles';
import { providerSecret } from './llm';
import { readProfileEnv, sdkEnv } from './llm-core';
import type { Module } from './module';
import { hasChannel, invoke } from './rpc';
import { getConfig, updateConfig } from './workspaceConfig';
import {
  type Installation,
  clearProgress,
  fallbackVcsProbe,
  fsScanDeps,
  gitDirOf,
  installSdk,
  installedVersion,
  normalizeTemplates,
  normalizeVcsProbe,
  npmCommand,
  placeholderTemplates,
  readProgress,
  realSpawnNpm,
  scanDocsFallback,
  scanRepos,
  writeProgress,
} from './wizard-core';

// The setup wizard's channels. Everything here is desktop-only (webPolicy.ts): it opens file dialogs, runs npm, tests keys and writes
// configuration. The pieces other agents are building (probeVcs, the cycle templates and the "prepare agents" scan, voice:*) are looked up at
// run time and the wizard falls back (or says "em breve") when they are not in the build.

declare global {
  interface ImportMeta {
    glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
  }
}

const SDK_DIR = join(DATA_ROOT, 'claude-sdk');

// ---- optional modules ---------------------------------------------------------------------------------------------------------------------
// import.meta.glob resolves at build time to whatever of these files exist, so the wizard compiles and works with or without them.
const vcsModules = import.meta.glob(['./vcs/index.ts', './vcs.ts']);

type Anything = Record<string, unknown>;

async function load(mods: Record<string, () => Promise<unknown>>): Promise<Anything[]> {
  const out: Anything[] = [];
  for (const importer of Object.values(mods)) {
    try {
      out.push((await importer()) as Anything);
    } catch (e) {
      console.error('[wizard] optional module failed to load', e instanceof Error ? e.message : e);
    }
  }
  return out;
}

function pickFn(mods: Anything[], names: string[]): ((...args: never[]) => unknown) | null {
  for (const m of mods) for (const n of names) if (typeof m[n] === 'function') return m[n] as (...args: never[]) => unknown;
  return null;
}

function pickValue(mods: Anything[], names: string[]): unknown {
  for (const m of mods) for (const n of names) if (m[n] !== undefined && typeof m[n] !== 'function') return m[n];
  return undefined;
}

async function availability(): Promise<WizardAvailability> {
  const vcs = await load(vcsModules);
  return {
    desktop: true,
    vcsProbe: !!pickFn(vcs, ['probeVcs']),
    // The cycle templates and the "prepare agents" scan are part of the build (src/main/cycles.ts).
    docsScanner: true,
    cycleTemplates: true,
    voiceCheck: hasChannel('voice:check'),
    voiceInstall: hasChannel('voice:install'),
    voiceTest: hasChannel('voice:test'),
    npm: npmFound(),
  };
}

function npmFound(): boolean {
  if (process.env.COXIA_NPM) return existsSync(process.env.COXIA_NPM);
  const name = npmCommand();
  return (process.env.PATH ?? '').split(delimiter).some((dir) => !!dir && existsSync(join(dir, name)));
}

// ---- provider test ------------------------------------------------------------------------------------------------------------------------

// i18n-ignore: connection test prompt for the model
const TEST_PROMPT = 'Reply with the single word OK.';
const TEST_TIMEOUT_MS = 90_000;

function failure(engine: ProviderTestResult['engine'], code: ProviderTestResult['code'], detail: string, started: number): ProviderTestResult {
  return { ok: false, engine, code, detail, messages: [], capabilities: null, models: [], catalog: [], answered: false, ms: Date.now() - started };
}

function modelFor(p: LlmProvider, requested: string | undefined): string {
  if (requested?.trim()) return requested.trim();
  const roles = getConfig().llm.roles;
  const used = Object.values(roles).find((r) => r.provider === p.id)?.model;
  return used ?? p.models[0] ?? '';
}

async function testOpen(p: LlmProvider, model: string, started: number): Promise<ProviderTestResult> {
  let key = '';
  try {
    key = providerSecret(p.secretRef) ?? '';
  } catch (e) {
    return failure('open', 'no-key', e instanceof Error ? e.message : String(e), started);
  }
  const r = await probeOpenAIProvider(p.baseUrl, key, model, { lang: getLanguage() });
  const caps = r.capabilities;
  return {
    ok: r.ok,
    engine: 'open',
    code: r.ok ? 'ok' : r.reachable ? 'failed' : 'unreachable',
    detail: r.chat.detail ?? r.models.detail ?? '',
    messages: r.messages,
    capabilities: r.ok ? { chat: caps.chat, tools: caps.tools, jsonSchema: caps.jsonSchema, streaming: caps.streaming, reasoning: caps.reasoning, contextWindow: caps.contextWindow ?? null, ...(caps.images !== undefined ? { images: caps.images } : {}) } : null,
    models: r.models.ids.slice(0, 300),
    catalog: r.catalog,
    answered: r.chat.ok,
    ms: Date.now() - started,
  };
}

/** A tiny call through the Claude Agent SDK, with the environment the provider would give a real agent. One short reply: a few tokens. */
async function testSdk(p: LlmProvider, model: string, started: number): Promise<ProviderTestResult> {
  if (locateSdk(getConfig().claudeSdk, HOME).mode === 'missing') return failure('claude-sdk', 'sdk-missing', '', started);
  let secret: string | null;
  try {
    secret = providerSecret(p.secretRef);
  } catch (e) {
    return failure('claude-sdk', 'no-key', e instanceof Error ? e.message : String(e), started);
  }
  // No retries: a test wants the first answer (a wrong key would otherwise be retried for minutes).
  const env = { ...sdkEnv({ target: { kind: p.kind, baseUrl: p.baseUrl, options: p.options }, base: process.env, secret, profile: readProfileEnv(p.envFile ? expandHome(p.envFile, HOME) : null), vcsHost: null }), CLAUDE_CODE_MAX_RETRIES: '0' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TEST_TIMEOUT_MS);
  try {
    const query = await loadClaudeQuery();
    const exe = claudeExecutable();
    let answered = false;
    let detail = '';
    const q = query({
      prompt: TEST_PROMPT,
      options: { model, env, maxTurns: 1, tools: [], allowedTools: [], settingSources: [], persistSession: false, cwd: ATAS, abortController: ctl, ...(exe ? { pathToClaudeCodeExecutable: exe } : {}) },
    });
    for await (const m of q) {
      if (m.type !== 'result') continue;
      answered = m.subtype === 'success' && !m.is_error;
      detail = m.subtype === 'success' ? String(m.result ?? '') : m.subtype;
    }
    return { ok: answered, engine: 'claude-sdk', code: answered ? 'ok' : 'failed', detail: answered ? '' : detail.slice(0, 400), messages: [], capabilities: null, models: [], catalog: [], answered, ms: Date.now() - started };
  } catch (e) {
    const aborted = ctl.signal.aborted;
    return failure('claude-sdk', aborted ? 'unreachable' : 'failed', aborted ? 'timeout' : e instanceof Error ? e.message.slice(0, 400) : String(e), started);
  } finally {
    clearTimeout(timer);
  }
}

async function testProvider(providerId: string, requestedModel?: string): Promise<ProviderTestResult> {
  const started = Date.now();
  const p = getConfig().llm.providers.find((x) => x.id === providerId);
  if (!p) return failure('open', 'unknown-provider', providerId, started);
  const model = modelFor(p, requestedModel);
  return p.engine === 'open' ? testOpen(p, model, started) : testSdk(p, model, started);
}

// ---- SDK installation -----------------------------------------------------------------------------------------------------------------

function bundledVersion(): string | null {
  return installedVersion(app.getAppPath());
}

function sdkStatus(): SdkStatus {
  const location = locateSdk(getConfig().claudeSdk, HOME);
  const version = location.mode === 'local' ? installedVersion(SDK_DIR) ?? getConfig().claudeSdk.version : location.mode === 'bundled' ? bundledVersion() : null;
  return { location, version, installDir: SDK_DIR, npmFound: npmFound() };
}

let installing: Installation | null = null;

// ---- folders and files ------------------------------------------------------------------------------------------------------------------

const parentWindow = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

async function pickPath(kind: 'dir' | 'file', title: string): Promise<FolderPick | null> {
  const options = { title, properties: kind === 'dir' ? (['openDirectory', 'createDirectory'] as const) : (['openFile', 'showHiddenFiles'] as const) };
  const win = parentWindow();
  const picked = win ? await dialog.showOpenDialog(win, { ...options, properties: [...options.properties] }) : await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
  const abs = picked.canceled ? null : (picked.filePaths[0] ?? null);
  if (!abs) return null;
  return { path: shrinkHome(abs, HOME), isRepo: kind === 'dir' && gitDirOf(abs, fsScanDeps(HOME)) !== null };
}

// ---- docs, cycles, vcs, voice -------------------------------------------------------------------------------------------------------------

function readDocsFound(raw: unknown): DocsFound | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Anything;
  const src = (typeof r.found === 'object' && r.found ? r.found : typeof r.docs === 'object' && r.docs ? r.docs : r) as Anything;
  const out: DocsFound = { claudeMdRoots: [], skillsDirs: [], rulesDirs: [], agentsDirs: [], knowledgeDirs: [], mcpConfigFiles: [] };
  let any = false;
  for (const key of DOCS_KEYS) {
    const v = src[key];
    if (Array.isArray(v)) {
      out[key] = v.filter((x): x is string => typeof x === 'string').map((x) => shrinkHome(x, HOME));
      any = true;
    }
  }
  return any ? out : null;
}

async function scanDocs(): Promise<DocsScanResult> {
  const cfg = getConfig();
  try {
    const prepared = prepareAgents(cfg, { home: HOME });
    const found = readDocsFound(prepared);
    if (found) {
      return {
        source: 'scanner',
        found,
        specsDir: prepared.docs.specsDir,
        projects: prepared.projects.filter((p) => p.exists).map((p) => ({ id: p.id, path: shrinkHome(p.path, HOME), summary: p.summary })),
        notes: prepared.notes,
      };
    }
  } catch (e) {
    console.error('[wizard] the agent scanner failed; using the built-in scan', e instanceof Error ? e.message : e);
  }
  const d = fsScanDeps(HOME);
  const bases = [...cfg.projects.roots, ...cfg.projects.repos.map((r) => r.path)];
  const repoBases = scanRepos(cfg.projects.roots, d).map((r) => r.path);
  return { source: 'fallback', found: scanDocsFallback([...new Set([...bases, ...repoBases])], d) };
}

async function cycleTemplates(): Promise<CycleTemplatesResult> {
  try {
    const templates = normalizeTemplates(listCycleTemplates(getConfig().language));
    if (templates.length) return { source: 'templates', templates };
  } catch (e) {
    console.error('[wizard] cycle templates failed to load', e instanceof Error ? e.message : e);
  }
  return { source: 'placeholder', templates: placeholderTemplates() };
}

async function testVcs(id: string): Promise<VcsTestResult> {
  const v: VcsIntegration | undefined = getConfig().vcs.find((x) => x.id === id);
  if (!v) return { ok: false, user: null, source: 'fallback', status: null, message: 'unknown-integration' };
  const probe = pickFn(await load(vcsModules), ['probeVcs']);
  if (probe) {
    try {
      return normalizeVcsProbe(await (probe as (v: VcsIntegration) => unknown)(v));
    } catch (e) {
      // A TypeError means probeVcs wants something else than an integration: fall through to the minimal call.
      if (!(e instanceof TypeError)) return { ok: false, user: null, source: 'vcs', status: null, message: e instanceof Error ? e.message : String(e) };
    }
  }
  let token: string | null = null;
  try {
    token = providerSecret(v.secretRef);
  } catch (e) {
    return { ok: false, user: null, source: 'fallback', status: null, message: e instanceof Error ? e.message : String(e) };
  }
  return fallbackVcsProbe(v, token, (url, init) => fetch(url, init));
}

async function runVoice(action: VoiceAction, options: unknown): Promise<VoiceRunResult> {
  const channel = `voice:${action}`;
  if (!hasChannel(channel)) return { available: false, ok: false, message: '' };
  try {
    const raw = (await invoke(channel, [options])) as unknown;
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Anything;
    const message = [r.message, r.detail, r.summary, r.error].find((x) => typeof x === 'string') as string | undefined;
    return { available: true, ok: r.ok !== false && r.error === undefined, message: message ?? (typeof raw === 'string' ? raw : '') };
  } catch (e) {
    return { available: true, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---- the module -----------------------------------------------------------------------------------------------------------------------------

export const wizard: Module = (ctx) => {
  ctx.handle(C.availability, (): Promise<WizardAvailability> => availability());

  ctx.handle(C.progressGet, (): WizardProgress => readProgress(ATAS));
  ctx.handle(C.progressSet, (progress: unknown): WizardProgress => writeProgress(ATAS, progress));
  ctx.handle(C.progressClear, (): void => clearProgress(ATAS));

  ctx.handle(C.providerTest, (providerId: string, model?: string): Promise<ProviderTestResult> => testProvider(String(providerId), typeof model === 'string' ? model : undefined));

  ctx.handle(C.sdkStatus, (): SdkStatus => sdkStatus());
  ctx.handle(C.sdkInstall, (): { started: boolean } => {
    if (installing) return { started: false };
    const emit = (e: SdkEvent) => ctx.emit({ type: 'module', name: SDK_EVENT, payload: e });
    const run = installSdk(SDK_DIR, {
      spawnNpm: realSpawnNpm,
      readVersion: installedVersion,
      emit: (e) => {
        if (e.phase === 'done') {
          try {
            updateConfig((c) => ({ ...c, claudeSdk: { installed: true, version: e.version, path: shrinkHome(e.path, HOME) } }));
          } catch (err) {
            emit({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
            return;
          }
        }
        emit(e);
      },
    });
    installing = run;
    void run.done.finally(() => {
      installing = null;
    });
    return { started: true };
  });
  ctx.handle(C.sdkCancel, (): void => installing?.cancel());

  ctx.handle(C.pickFolder, (kind: 'dir' | 'file', title: string): Promise<FolderPick | null> => pickPath(kind === 'file' ? 'file' : 'dir', typeof title === 'string' ? title : ''));
  ctx.handle(C.scanProjects, (roots: string[]): ScannedRepo[] => scanRepos((Array.isArray(roots) ? roots : []).filter((r) => typeof r === 'string'), fsScanDeps(HOME)));
  ctx.handle(C.pathsExist, (paths: string[]): boolean[] => (Array.isArray(paths) ? paths : []).map((p) => typeof p === 'string' && existsSync(expandHome(p, HOME))));

  ctx.handle(C.vcsTest, (id: string): Promise<VcsTestResult> => testVcs(String(id)));
  ctx.handle(C.docsScan, (): Promise<DocsScanResult> => scanDocs());
  ctx.handle(C.cycleTemplates, (): Promise<CycleTemplatesResult> => cycleTemplates());
  ctx.handle(C.voiceRun, (action: VoiceAction, options: unknown): Promise<VoiceRunResult> => runVoice(action, options));
};
