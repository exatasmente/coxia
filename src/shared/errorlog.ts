import { getLanguage, t } from './i18n';
// One line of <DATA_ROOT>/logs/errors.jsonl. Everything in it has already been through the redaction pass.
export interface ErrorEntry {
  time: string;
  workspace: string;
  // rpc:<channel> | job:<name> | sidecar:voice | renderer:<kind> | main:<event>
  source: string;
  name: string;
  message: string;
  stack: string;
  context: Record<string, string | number | boolean>;
}

export interface ErrorGroup {
  message: string;
  count: number;
  firstAt: string;
  lastAt: string;
  sources: string[];
  workspaces: string[];
  // Stack and context of the newest occurrence.
  stack: string;
  context: Record<string, string | number | boolean>;
  hint: string | null;
  // Happened after the last time Saúde was opened.
  unseen: boolean;
}

export interface ErrorsView {
  groups: ErrorGroup[];
  total: number;
  // Distinct messages from the last 24 h that came after the last time Saúde was opened.
  unseen: number;
  file: string;
}

export interface ErrorsSummary {
  unseen: number;
  total: number;
}

export const RENDERER_KINDS = ['error', 'unhandledrejection', 'react'] as const;
export type RendererKind = (typeof RENDERER_KINDS)[number];

export interface RendererReport {
  kind: RendererKind;
  message: string;
  stack?: string;
  platform?: 'web' | 'desktop';
}

const NETWORK = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|could not resolve host|fetch failed|network is unreachable/i;
// The code host the workspace uses (GitLab, GitHub, Bitbucket) or its CLI; the host name itself is the workspace's, not this file's.
const GITLAB = /gitlab|github|bitbucket|\bglab\b|\bgh\b/i;

const HINTS: { test: (text: string, source: string) => boolean; hint: string }[] = [
  { test: (t) => /error_max_turns/i.test(t), hint: 'main.errorlog.hint.maxTurns' },
  { test: (t) => /voice sidecar exited/i.test(t), hint: 'main.errorlog.hint.voiceSidecar' },
  { test: (t) => /spawn (glab|gh) ENOENT|(glab|gh): (command )?not found|O comando (glab|gh) não foi encontrado|The command (glab|gh) was not found/i.test(t), hint: 'main.errorlog.hint.cliMissing' },
  { test: (t, s) => /not logged in|glab auth login|gh auth login|authentication required|no token|\b401\b|unauthorized|recusou a credencial|rejected the credential/i.test(t) && (GITLAB.test(t) || /gitlab|github|bitbucket|glab|vcs|cards|radar|watchers|feedback|worktrees|efeitos/i.test(s)), hint: 'main.errorlog.hint.accessRefused' },
  { test: (t, s) => NETWORK.test(t) && (GITLAB.test(t) || /gitlab|github|bitbucket|glab|vcs|cards|radar|watchers|feedback|worktrees/i.test(s)), hint: 'main.errorlog.hint.networkVpn' },
  { test: (t) => /\b402\b|insufficient (credits|funds)|payment required|out of credits/i.test(t), hint: 'main.errorlog.hint.orCredits' },
  { test: (t) => /\b401\b|invalid (x-)?api[ -]?key|incorrect api key|user not found/i.test(t) && /openrouter|api error|anthropic|invalid|key|authentication/i.test(t), hint: 'main.errorlog.hint.orKeyRefused' },
  { test: (t) => /sem chave configurada/i.test(t) && /openrouter/i.test(t), hint: 'main.errorlog.hint.orKeyMissing' },
  { test: (t) => NETWORK.test(t) && /openrouter/i.test(t), hint: 'main.errorlog.hint.orNetwork' },
  { test: (t) => /EADDRINUSE/.test(t), hint: 'main.errorlog.hint.portInUse' },
  { test: (t) => /ENOSPC/.test(t), hint: 'main.errorlog.hint.diskFull' },
  { test: (t) => /canal desconhecido/i.test(t), hint: 'main.errorlog.hint.versionMismatch' },
  { test: (t) => /timed? ?out|timeout|aborted due to timeout/i.test(t), hint: 'main.errorlog.hint.timeout' },
  { test: (t) => NETWORK.test(t), hint: 'main.errorlog.hint.network' },
];

export function errorHint(message: string, source = '', stack = ''): string | null {
  const text = `${message}\n${stack.split('\n').slice(0, 2).join('\n')}`;
  const found = HINTS.find((h) => h.test(text, source));
  return found ? t(found.hint) : null;
}

const stamp = (iso: string) => new Date(iso).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const REPORT_LIMIT = 7000;
const STACK_LINES = 8;

// Compact text for pasting into a Claude Code session: messages, counts, sources and the top of each stack.
export function errorReport(view: Pick<ErrorsView, 'groups' | 'file'>, max = 10): string {
  const lines = [t('main.errorlog.report.intro'), t('main.errorlog.report.file', { file: view.file }), ''];
  view.groups.slice(0, max).forEach((g, i) => {
    lines.push(`${i + 1}. ${g.message}`);
    lines.push(`   ${t('main.errorlog.report.group', { count: g.count, from: stamp(g.firstAt), to: stamp(g.lastAt), sources: g.sources.join(', '), workspaces: g.workspaces.join(', ') })}`);
    if (g.hint) lines.push(`   ${t('main.errorlog.report.hint', { hint: g.hint })}`);
    const ctx = Object.entries(g.context).map(([k, v]) => `${k}=${v}`).join(' ');
    if (ctx) lines.push(`   ${t('main.errorlog.report.context', { context: ctx })}`);
    if (g.stack) lines.push(...g.stack.split('\n').slice(0, STACK_LINES).map((l) => `   | ${l.trim()}`));
    lines.push('');
  });
  const text = lines.join('\n').trimEnd();
  return text.length > REPORT_LIMIT ? `${text.slice(0, REPORT_LIMIT)}\n${t('main.errorlog.report.cut')}` : text;
}
