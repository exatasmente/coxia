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
const GITLAB = /dark\.smartzap|gitlab|\bglab\b/i;

const HINTS: { test: (text: string, source: string) => boolean; hint: string }[] = [
  { test: (t) => /error_max_turns/i.test(t), hint: 'O agente parou antes de terminar: peça de novo ou faça uma pergunta mais estreita.' },
  { test: (t) => /voice sidecar exited/i.test(t), hint: 'O sidecar de voz caiu: reabra o app. Se repetir, rode o app pelo terminal e veja o stderr ([voice]).' },
  { test: (t) => /spawn glab ENOENT|glab: (command )?not found/i.test(t), hint: 'O glab não está instalado ou fora do PATH.' },
  { test: (t, s) => /not logged in|glab auth login|authentication required|no token|\b401\b|unauthorized/i.test(t) && (GITLAB.test(t) || /gitlab|glab/i.test(s)), hint: 'O glab não está autenticado: rode glab auth login --hostname dark.smartzap.com.br.' },
  { test: (t, s) => NETWORK.test(t) && (GITLAB.test(t) || /gitlab|glab|radar|watchers|feedback|worktrees/i.test(s)), hint: 'Sem rede ou VPN: o GitLab não respondeu.' },
  { test: (t) => /\b402\b|insufficient (credits|funds)|payment required|out of credits/i.test(t), hint: 'Chave ou saldo da OpenRouter: o saldo acabou ou a chave não vale mais. Confira em openrouter.ai.' },
  { test: (t) => /\b401\b|invalid (x-)?api[ -]?key|incorrect api key|user not found/i.test(t) && /openrouter|api error|anthropic|invalid|key|authentication/i.test(t), hint: 'Chave ou saldo da OpenRouter: a chave foi recusada. Rode openrouter-key --status.' },
  { test: (t) => /openrouter-key|sem chave da openrouter/i.test(t), hint: 'Não encontrei a chave da OpenRouter. Rode openrouter-key --status no terminal.' },
  { test: (t) => NETWORK.test(t) && /openrouter/i.test(t), hint: 'Sem rede para falar com a OpenRouter.' },
  { test: (t) => /EADDRINUSE/.test(t), hint: 'A porta já está em uso por outro processo.' },
  { test: (t) => /ENOSPC/.test(t), hint: 'O disco está cheio.' },
  { test: (t) => /canal desconhecido/i.test(t), hint: 'A página e o app estão em versões diferentes: recarregue a página.' },
  { test: (t) => /timed? ?out|timeout|aborted due to timeout/i.test(t), hint: 'Tempo esgotado: tente de novo; se repetir, veja a rede e a VPN.' },
  { test: (t) => NETWORK.test(t), hint: 'Sem rede: a conexão falhou.' },
];

export function errorHint(message: string, source = '', stack = ''): string | null {
  const text = `${message}\n${stack.split('\n').slice(0, 2).join('\n')}`;
  return HINTS.find((h) => h.test(text, source))?.hint ?? null;
}

const stamp = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const REPORT_LIMIT = 7000;
const STACK_LINES = 8;

// Compact text for pasting into a Claude Code session: messages, counts, sources and the top of each stack.
export function errorReport(view: Pick<ErrorsView, 'groups' | 'file'>, max = 10): string {
  const lines = ['Erros recentes registrados pelo app Cerimônias (do mais novo para o mais antigo). Investigue a causa provável e proponha a correção.', `Log completo: ${view.file}`, ''];
  view.groups.slice(0, max).forEach((g, i) => {
    lines.push(`${i + 1}. ${g.message}`);
    lines.push(`   ${g.count}x, de ${stamp(g.firstAt)} a ${stamp(g.lastAt)}, origem ${g.sources.join(', ')}, workspace ${g.workspaces.join(', ')}`);
    if (g.hint) lines.push(`   dica: ${g.hint}`);
    const ctx = Object.entries(g.context).map(([k, v]) => `${k}=${v}`).join(' ');
    if (ctx) lines.push(`   contexto: ${ctx}`);
    if (g.stack) lines.push(...g.stack.split('\n').slice(0, STACK_LINES).map((l) => `   | ${l.trim()}`));
    lines.push('');
  });
  const text = lines.join('\n').trimEnd();
  return text.length > REPORT_LIMIT ? `${text.slice(0, REPORT_LIMIT)}\n[cortado]` : text;
}
