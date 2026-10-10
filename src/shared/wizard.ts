import type { VcsProbeResult } from './vcs';
import type { AgentDef, CeremonyId, EngineId, LlmProvider, LlmRole, ProviderCapabilities, ProviderFeatures, ProviderKind, VcsKind, WorkspaceConfig } from './config/types';
import { LLM_ROLES, defaultEngine } from './config/types';
import type { SdkLocationView } from './configView';
import type { CatalogModel } from './modelCatalog';
import { ENV_NAME, SECRET_MAX_LENGTH, SECRET_REF, type SecretInput, type SecretSourceType } from './secrets';

// Everything the setup wizard's screens and the main process agree on: the steps, the presets, the pure helpers (recommendations, remote
// parsing, ids) and the shapes of the wizard:* channels. The channels only exist in the desktop window (webPolicy.ts).

export const WIZARD_STEPS = ['language', 'models', 'sdk', 'projects', 'integrations', 'docs', 'cycle', 'voice', 'review'] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number];

/** The opening step and the last one always run; every step between them, the model choice included, may be skipped. */
export const SKIPPABLE_STEPS: readonly WizardStepId[] = ['models', 'sdk', 'projects', 'integrations', 'docs', 'cycle', 'voice'];

export interface WizardProgress {
  step: WizardStepId;
  done: WizardStepId[];
  skipped: WizardStepId[];
  updatedAt: string;
}

export const WIZARD_CHANNELS = {
  availability: 'wizard:availability',
  progressGet: 'wizard:progress-get',
  progressSet: 'wizard:progress-set',
  progressClear: 'wizard:progress-clear',
  providerTest: 'wizard:provider-test',
  sdkStatus: 'wizard:sdk-status',
  sdkInstall: 'wizard:sdk-install',
  sdkCancel: 'wizard:sdk-cancel',
  pickFolder: 'wizard:pick-folder',
  scanProjects: 'wizard:scan-projects',
  pathsExist: 'wizard:paths-exist',
  vcsTest: 'wizard:vcs-test',
  docsScan: 'wizard:docs-scan',
  cycleTemplates: 'wizard:cycle-templates',
  voiceRun: 'wizard:voice-run',
} as const;

/** Module event of the SDK installation (progress lines until done). */
export const SDK_EVENT = 'wizard-sdk';

// ---- steps ------------------------------------------------------------------------------------------------------------------------------

/** The Claude Agent SDK is needed when a provider runs on it. */
export function needsSdk(config: Pick<WorkspaceConfig, 'llm'>): boolean {
  return config.llm.providers.some((p) => p.engine === 'claude-sdk');
}

/** The steps this configuration goes through: the SDK step only appears when a provider uses the SDK engine. */
export function visibleSteps(config: Pick<WorkspaceConfig, 'llm'>): WizardStepId[] {
  return WIZARD_STEPS.filter((s) => s !== 'sdk' || needsSdk(config));
}

export function emptyProgress(now = new Date()): WizardProgress {
  return { step: WIZARD_STEPS[0], done: [], skipped: [], updatedAt: now.toISOString() };
}

/** A stored progress document, checked. Anything wrong falls back to the first step. */
export function parseProgress(raw: unknown, now = new Date()): WizardProgress {
  const fresh = emptyProgress(now);
  if (typeof raw !== 'object' || raw === null) return fresh;
  const r = raw as Record<string, unknown>;
  const steps = (v: unknown): WizardStepId[] => (Array.isArray(v) ? v.filter((x): x is WizardStepId => (WIZARD_STEPS as readonly unknown[]).includes(x)) : []);
  const step = (WIZARD_STEPS as readonly unknown[]).includes(r.step) ? (r.step as WizardStepId) : fresh.step;
  return { step, done: steps(r.done), skipped: steps(r.skipped), updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : fresh.updatedAt };
}

// ---- providers --------------------------------------------------------------------------------------------------------------------------

export interface KindInfo {
  kind: ProviderKind;
  /** The Claude Agent SDK serves it. */
  claude: boolean;
}

export const PROVIDER_CHOICES: KindInfo[] = [
  { kind: 'anthropic', claude: true },
  { kind: 'bedrock', claude: true },
  { kind: 'vertex', claude: true },
  { kind: 'foundry', claude: true },
  { kind: 'openai-compatible', claude: false },
];

export type PresetId = 'openai' | 'openrouter' | 'groq' | 'deepseek' | 'deepinfra' | 'ollama' | 'lmstudio' | 'custom';

export interface OpenPreset {
  id: PresetId;
  baseUrl: string;
  /** Runs on this machine: no key, and the context window is the thing to check. */
  local: boolean;
  keyRequired: boolean;
  /** A starting suggestion for the model field; the connection test replaces it with what the server lists. */
  suggestedModels: string[];
  /** Where the user creates a key. */
  keyUrl: string | null;
  headers: Record<string, string>;
  /** What this provider's server takes beyond the protocol; a new provider built from the preset starts with it on, an existing one only by the person's choice. */
  features?: ProviderFeatures;
}

export const OPEN_PRESETS: OpenPreset[] = [
  { id: 'openai', baseUrl: 'https://api.openai.com/v1', local: false, keyRequired: true, suggestedModels: ['gpt-4.1-mini', 'gpt-4.1'], keyUrl: 'https://platform.openai.com/api-keys', headers: {} },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', local: false, keyRequired: true, suggestedModels: ['deepseek/deepseek-chat'], keyUrl: 'https://openrouter.ai/settings/keys', headers: { 'X-Title': 'Coxia' } },
  { id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', local: false, keyRequired: true, suggestedModels: ['llama-3.3-70b-versatile'], keyUrl: 'https://console.groq.com/keys', headers: {} },
  { id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', local: false, keyRequired: true, suggestedModels: ['deepseek-chat'], keyUrl: 'https://platform.deepseek.com/api_keys', headers: {} },
  { id: 'deepinfra', baseUrl: 'https://api.deepinfra.com/v1/openai', local: false, keyRequired: true, suggestedModels: ['meta-llama/Meta-Llama-3.1-8B-Instruct'], keyUrl: 'https://deepinfra.com/dash/api_keys', headers: {}, features: { serviceTier: true, failFast: true, reasoningEffort: true, catalogUrl: 'https://api.deepinfra.com/models/list' } },
  { id: 'ollama', baseUrl: 'http://localhost:11434/v1', local: true, keyRequired: false, suggestedModels: ['qwen3:8b'], keyUrl: null, headers: {} },
  { id: 'lmstudio', baseUrl: 'http://localhost:1234/v1', local: true, keyRequired: false, suggestedModels: [], keyUrl: null, headers: {} },
  { id: 'custom', baseUrl: '', local: false, keyRequired: false, suggestedModels: [], keyUrl: null, headers: {} },
];

/** The features of the preset a provider's address belongs to (same origin), or null: what "use the preset's" offers an existing provider. Nothing applies it on its own. */
export function presetFeaturesOf(baseUrl: string): ProviderFeatures | null {
  const origin = (u: string): string | null => {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  };
  const mine = origin(baseUrl);
  const preset = mine === null ? undefined : OPEN_PRESETS.find((p) => p.features && origin(p.baseUrl) === mine);
  return preset?.features ? { ...preset.features } : null;
}

export const presetById = (id: string): OpenPreset => OPEN_PRESETS.find((p) => p.id === id) ?? OPEN_PRESETS[OPEN_PRESETS.length - 1];

/** Claude's model aliases: they work on the Anthropic API and on the three clouds, which map them to their own ids. */
export const CLAUDE_MODEL_ALIASES = ['haiku', 'sonnet', 'opus'];

/** Where each Claude cloud's credentials are documented (shown next to the fields). */
export const DOC_LINKS = {
  legal: 'https://code.claude.com/docs/en/legal-and-compliance',
  commercialTerms: 'https://www.anthropic.com/legal/commercial-terms',
  bedrock: 'https://code.claude.com/docs/en/amazon-bedrock',
  vertex: 'https://code.claude.com/docs/en/google-vertex-ai',
  foundry: 'https://code.claude.com/docs/en/microsoft-foundry',
  anthropicKeys: 'https://console.anthropic.com/settings/keys',
} as const;

const SLUG = /[^a-z0-9_-]+/g;

/** A provider id that is unique among the existing ones: "openai", then "openai-2"... */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = base.toLowerCase().replace(SLUG, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const id = `${root}-${n}`;
    if (!used.has(id)) return id;
  }
}

export const providerSecretRef = (providerId: string): string => `llm.${providerId}`;
export const vcsSecretRef = (vcsId: string): string => `vcs.${vcsId}`;

export interface ProviderDraft {
  kind: ProviderKind;
  preset: PresetId;
  /** openai-compatible: root URL as typed. */
  baseUrl: string;
  /** bedrock: region, profile. vertex: project, region. foundry: resource. */
  options: Record<string, string>;
  model: string;
}

/** The provider the add form builds. The secret is stored separately; this only carries its reference. */
export function buildProvider(draft: ProviderDraft, taken: Iterable<string>, withSecret: boolean): LlmProvider {
  const preset = draft.kind === 'openai-compatible' ? presetById(draft.preset) : null;
  const base = draft.kind === 'openai-compatible' ? (draft.preset === 'custom' ? 'custom' : draft.preset) : draft.kind;
  const id = uniqueId(base, taken);
  const options = Object.fromEntries(Object.entries(draft.options).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  const model = draft.model.trim();
  const models = draft.kind === 'openai-compatible' ? [...new Set([...(model ? [model] : []), ...(preset?.suggestedModels ?? [])])] : [...CLAUDE_MODEL_ALIASES, ...(model && !CLAUDE_MODEL_ALIASES.includes(model) ? [model] : [])];
  return {
    id,
    kind: draft.kind,
    engine: defaultEngine(draft.kind),
    baseUrl: draft.kind === 'anthropic' ? 'https://api.anthropic.com' : draft.kind === 'openai-compatible' ? draft.baseUrl.trim().replace(/\/+$/, '') : '',
    models,
    secretRef: withSecret ? providerSecretRef(id) : null,
    envFile: null,
    options,
    capabilities: null,
    structured: 'auto',
    headers: preset ? { ...preset.headers } : {},
    maxOutputTokens: null,
    temperature: null,
    timeoutMs: null,
    legacyCustomEndpoint: false,
    ...(preset?.features ? { features: { ...preset.features } } : {}),
  };
}

// ---- roles ------------------------------------------------------------------------------------------------------------------------------

export type RoleTier = 'fast' | 'strong' | 'cheap';
export const ROLE_TIERS: Record<LlmRole, RoleTier> = { turn: 'fast', reply: 'fast', deep: 'strong', teams: 'fast', fix: 'cheap' };

const LIGHT = /(mini|flash|haiku|small|lite|instant|nano|turbo|\b(?:3|4|7|8)b\b)/i;
const HEAVY = /(opus|sonnet|\bpro\b|large|max|reason|\b(?:70|72|120|235|405)b\b|r1|v4)/i;

/** The model a provider offers for a kind of work: a light one for fast and cheap roles, a strong one for the deep role. */
export function recommendModel(provider: Pick<LlmProvider, 'models'>, tier: RoleTier): string | null {
  const list = provider.models;
  if (!list.length) return null;
  if (tier === 'strong') return list.find((m) => HEAVY.test(m)) ?? list.find((m) => !LIGHT.test(m)) ?? list[0];
  return list.find((m) => LIGHT.test(m)) ?? list[0];
}

export interface RoleChoice {
  provider: string;
  model: string;
}

/** A model per role: every role on the first provider (the one the user added first), the model picked by the role's tier. */
export function recommendRoles(providers: Pick<LlmProvider, 'id' | 'models'>[]): Record<LlmRole, RoleChoice> | null {
  const primary = providers[0];
  if (!primary) return null;
  return Object.fromEntries(LLM_ROLES.map((r) => [r, { provider: primary.id, model: recommendModel(primary, ROLE_TIERS[r]) ?? '' }])) as Record<LlmRole, RoleChoice>;
}

export type CapabilityWarning = 'no-chat' | 'no-tools' | 'small-context' | 'tiny-context' | 'no-json-schema' | 'untested';

export const MIN_CONTEXT = 12_000;
export const TINY_CONTEXT = 6_000;

/** What the connection test found out that the user should know before picking the provider for a role. */
export function capabilityWarnings(caps: ProviderCapabilities | null): CapabilityWarning[] {
  if (!caps) return ['untested'];
  const out: CapabilityWarning[] = [];
  if (!caps.chat) out.push('no-chat');
  if (!caps.tools) out.push('no-tools');
  if (caps.contextWindow !== null && caps.contextWindow < TINY_CONTEXT) out.push('tiny-context');
  else if (caps.contextWindow !== null && caps.contextWindow < MIN_CONTEXT) out.push('small-context');
  if (!caps.jsonSchema) out.push('no-json-schema');
  return out;
}

export interface ProviderTestResult {
  ok: boolean;
  engine: EngineId;
  /** Why it failed, when it did: a code the screen translates, plus the raw detail. */
  code: 'ok' | 'sdk-missing' | 'no-key' | 'failed' | 'unreachable' | 'unknown-provider';
  detail: string;
  /** Open engine: human lines from the probe, in the interface language. */
  messages: string[];
  capabilities: ProviderCapabilities | null;
  /** Open engine: the models the server lists. */
  models: string[];
  /** Open engine: what the listing says of each model (price, window, capabilities; null where it said nothing). The tested model carries what the test found. */
  catalog: CatalogModel[];
  /** The model answered the test prompt (SDK engines). */
  answered: boolean;
  ms: number;
}

// ---- git remotes ------------------------------------------------------------------------------------------------------------------------

export interface ParsedRemote {
  host: string;
  /** "group/sub/name" without ".git". */
  projectPath: string;
  kind: VcsKind;
}

export function guessVcsKind(host: string): VcsKind {
  const h = host.toLowerCase();
  if (h.includes('github')) return 'github';
  if (h.includes('bitbucket')) return 'bitbucket';
  return 'gitlab';
}

/** The host and project path of a remote URL, in the three shapes git uses (scp-like, ssh://, https://). Null when it is not one. */
export function parseRemote(url: string | null | undefined): ParsedRemote | null {
  const raw = (url ?? '').trim();
  if (!raw) return null;
  let host = '';
  let path = '';
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(raw);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  } else if (scp) {
    host = scp[1];
    path = scp[2];
  } else return null;
  const projectPath = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (!host || !projectPath || !projectPath.includes('/')) return null;
  return { host: host.toLowerCase(), projectPath, kind: guessVcsKind(host) };
}

// ---- project scan -----------------------------------------------------------------------------------------------------------------------

export interface ScannedRepo {
  /** Short id, from the folder name (a valid repo id). */
  id: string;
  /** With "~/" when under the home folder. */
  path: string;
  remoteUrl: string | null;
  host: string | null;
  projectPath: string | null;
  kind: VcsKind | null;
}

export interface FolderPick {
  path: string;
  /** The folder is itself a git checkout. */
  isRepo: boolean;
}

// ---- docs, cycles, voice, vcs, sdk ------------------------------------------------------------------------------------------------------

export interface DocsFound {
  claudeMdRoots: string[];
  skillsDirs: string[];
  rulesDirs: string[];
  agentsDirs: string[];
  knowledgeDirs: string[];
  mcpConfigFiles: string[];
}

export type DocsKey = keyof DocsFound;
export const DOCS_KEYS: DocsKey[] = ['claudeMdRoots', 'skillsDirs', 'rulesDirs', 'agentsDirs', 'knowledgeDirs', 'mcpConfigFiles'];

export interface DocsScanResult {
  /** Which scanner answered: the cycle work's "prepare agents" scan, or the built-in minimal one. */
  source: 'scanner' | 'fallback';
  found: DocsFound;
  /** The folder of issue specs the scan suggests (the prepare-agents scan only). */
  specsDir?: string | null;
  /** One short summary per project scanned (the prepare-agents scan only); no model is involved. */
  projects?: { id: string; path: string; summary: string }[];
  /** What the scan left out or noticed, in the language of the workspace. */
  notes?: string[];
}

export interface CycleTemplateInfo {
  id: string;
  name: string;
  description: string;
  /** The template can be applied; false for the placeholders listed while the real ones are not built. */
  available: boolean;
  /** The pieces of config the template sets (a DeepPartial of WorkspaceConfig). Null for a placeholder. */
  patch: Record<string, unknown> | null;
  /** The ceremonies the template switches on, when it says. */
  ceremonies: Partial<Record<CeremonyId, boolean>> | null;
  stages: { id: string; label: string }[];
  /** What the person still has to provide for the template to be fully useful ("specsDir", "qaUser"...). */
  needs?: string[];
  /** The agents the template brings; choosing it adds those the workspace lacks. */
  team?: AgentDef[];
}

export interface CycleTemplatesResult {
  source: 'templates' | 'placeholder';
  templates: CycleTemplateInfo[];
}

export interface VcsTestResult {
  /** The whole probe when probeVcs answered: token permissions, a sample of issues and merge requests, warnings. */
  probe?: VcsProbeResult;
  ok: boolean;
  user: string | null;
  /** probeVcs answered, or the wizard's own minimal call. */
  source: 'vcs' | 'fallback';
  /** HTTP status of the fallback call, when there was one. */
  status: number | null;
  message: string;
}

export interface VoiceRunResult {
  /** The voice API exists in this build. */
  available: boolean;
  ok: boolean;
  message: string;
}

export interface WizardAvailability {
  /** The wizard can write configuration here (the desktop window); a browser only reads. */
  desktop: boolean;
  vcsProbe: boolean;
  docsScanner: boolean;
  cycleTemplates: boolean;
  voiceCheck: boolean;
  voiceInstall: boolean;
  voiceTest: boolean;
  npm: boolean;
}

export interface SdkStatus {
  location: SdkLocationView;
  /** Version of the bundled copy or of the local install, when known. */
  version: string | null;
  /** Folder the wizard installs into. */
  installDir: string;
  npmFound: boolean;
}

export type SdkEvent =
  | { phase: 'start'; dir: string }
  | { phase: 'log'; line: string }
  | { phase: 'done'; version: string; path: string }
  | { phase: 'error'; message: string }
  | { phase: 'cancelled' };

export type VoiceAction = 'check' | 'install' | 'test';

// ---- secret entry -----------------------------------------------------------------------------------------------------------------------

/** What a secret field holds while the user types: one source at a time. The value never leaves the form except through secretInputFrom. */
export interface SecretDraft {
  source: SecretSourceType;
  value: string;
  envName: string;
  command: string;
}

export const emptySecretDraft = (source: SecretSourceType = 'stored'): SecretDraft => ({ source, value: '', envName: '', command: '' });

export type SecretProblem = 'empty' | 'bad-ref' | 'too-long' | 'bad-env-name';

/** The input for `config:secret-set` from what the user typed, or the reason it cannot be sent. */
export function secretInputFrom(ref: string, d: SecretDraft): { input: SecretInput } | { problem: SecretProblem } {
  if (!SECRET_REF.test(ref)) return { problem: 'bad-ref' };
  if (d.source === 'stored') {
    if (!d.value.trim()) return { problem: 'empty' };
    if (d.value.length > SECRET_MAX_LENGTH) return { problem: 'too-long' };
    return { input: { ref, source: 'stored', value: d.value.trim() } };
  }
  if (d.source === 'env') {
    if (!d.envName.trim()) return { problem: 'empty' };
    return ENV_NAME.test(d.envName.trim()) ? { input: { ref, source: 'env', name: d.envName.trim() } } : { problem: 'bad-env-name' };
  }
  const parts = d.command.trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map((p) => p.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
  if (!parts.length) return { problem: 'empty' };
  return { input: { ref, source: 'command', command: parts[0], args: parts.slice(1) } };
}
