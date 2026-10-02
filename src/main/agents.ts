import { type HookCallback, type Options, query } from '@anthropic-ai/claude-agent-sdk';
import { destination } from '../shared/destination';
import type { AgentTurn, Card, DeepAnswer, DeepOption, Decision, DecisionTarget, Minutes, ReplyResult } from '../shared/types';
import type { ModelRole } from '../shared/settings';
import { getSettings } from './config';
import { WORKSPACE, agentEnv } from './env';

const MCP_GITLAB = [
  'mcp__gitlab-issue-analysis__get_issue_details_and_comments',
  'mcp__gitlab-issue-analysis__get_merge_request_details_and_changes',
];
const GLAB_RULES = ['Bash(glab api:*)', 'Bash(glab mr view:*)', 'Bash(glab issue view:*)'];

// Tools pre-approved for a role, from the settings; dontAsk denies everything else.
function allowedFor(role: ModelRole): string[] {
  if (role === 'teams') return [];
  const t = getSettings().tools;
  return [
    ...(t.files ? ['Read', 'Grep', 'Glob'] : []),
    ...(t.skills ? ['Skill'] : []),
    ...(t.gitlabMcp ? MCP_GITLAB : []),
    ...(t.glab ? GLAB_RULES : []),
    ...(t.subagents && role === 'deep' ? ['Agent'] : []),
  ];
}

// The only shell commands a ceremony agent may run: GitLab reads, one command, no flags that write.
export const GLAB_READ = [
  /^glab api "?projects\/[\w%.-]+\/(merge_requests|issues)\/\d+(\/(discussions|notes|approvals|changes|pipelines))?(\?[\w=&]+)?"?( --paginate)?$/,
  /^glab api "?projects\/[\w%.-]+\/pipelines(\/\d+(\/jobs)?)?(\?[\w=&%./-]+)?"?$/,
  /^glab (mr|issue) view \d+ -R [\w./-]+( --comments)?$/,
];

// Conflict calls may also read the post-release-sync mirrors; plumbing reads only, no options that write.
export const GIT_MIRROR_READ = [
  // Arguments never start with a dash except the bare `--`: no --no-index, --output or --ext-diff; no `..` in the repo path.
  /^git -C \/home\/[\w-][\w.-]*\/\.cache\/post-release-sync\/(?!\S*\.\.)[\w./-]+\.git (merge-tree --write-tree( --name-only)?|diff( --stat)?|show( --stat)?|log --oneline( -\d+)?|merge-base)( (--|[\w./:^~][\w./:^~-]*))+$/,
];

// Trailing stderr merge and a head limit only shorten the output, so they are accepted on any allowed command.
export function stripOutputSuffix(command: string): string {
  return command.trim().replace(/( 2>&1)?( \| head -[cn] \d+)?$/, '');
}

export function shellAllowlist(patterns: RegExp[]): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return {};
    const command = stripOutputSuffix(String((input.tool_input as { command?: unknown }).command ?? ''));
    if (patterns.some((re) => re.test(command))) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Na cerimônia o terminal só lê, um comando por vez (sem ; && ou pipes, exceto | head). Use: ${GITLAB_HINT}${patterns.length > GLAB_READ.length ? ` ${GIT_HINT}` : ''}`,
      },
    };
  };
}

// Agents run on a third-party model: secret files never enter the context.
export const SECRET_PATH = /(^|\/)\.env($|[./*?])|\.env$|secret|credential|token|(^|[\/_.-])key$|\.pem$|(^|\/)\.(ssh|config|aws|docker)($|\/)|(^|\/)\.netrc$|\.mcp\.json$|\.claude\.json$/i;

export const noSecrets: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  const args = input.tool_input as { file_path?: unknown; path?: unknown; pattern?: unknown; glob?: unknown };
  const paths = [args.file_path, args.path, input.tool_name === 'Glob' ? args.pattern : null, args.glob].filter(
    (p): p is string => typeof p === 'string',
  );
  if (!paths.some((p) => SECRET_PATH.test(p))) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Arquivo de configuração ou segredo: fora do alcance da cerimônia.',
    },
  };
};

const GIT_HINT =
  'No conflito: `git -C <repo do mirror> merge-tree --write-tree --name-only <src_sha> <tgt_sha>`, `git -C <repo> merge-base <src_sha> <tgt_sha>`, `git -C <repo> diff <base> <src_sha> -- <arquivo>` e `git -C <repo> diff <base> <tgt_sha> -- <arquivo>`.';

const GITLAB_HINT =
  '`glab api projects/<grupo%2Frepo>/merge_requests/<iid>/discussions` (discussões de MR), ' +
  '`glab api projects/<grupo%2Frepo>/issues/<iid>/notes` (comentários de issue) ou ' +
  '`glab mr view <iid> -R <grupo/repo> --comments`. O caminho de cada MR está em mrPaths do cartão.';

const SPEECH_RULES =
  'Português do Brasil falado: frases curtas, sem markdown, sem listas, sem emoji. ' +
  'Issue pelo número curto ("a 15499"), MR pelo repositório e número ("o 797 do hub-whatsapp"). ' +
  'Fale só o que está no cartão ou no que você leu nesta sessão; não deduza causa técnica nem invente estado.';

const ROLE =
  'Você participa de uma cerimônia por voz do Luiz como agente de uma atividade. ' +
  'A cerimônia é somente leitura: não edite arquivos, não publique nada; no terminal, só leitura do GitLab. ' +
  'Toda ação com efeito externo vira item da ata para o Luiz executar depois, com confirmação.';

interface Run<T> {
  data: T;
  sessionId: string;
  sources: string[];
}

type Schema = Record<string, unknown>;

const str = { type: 'string' };
const strOrNull = { type: ['string', 'null'] };

function obj(properties: Record<string, unknown>): Schema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function source(name: string, input: Record<string, unknown>): string {
  const detail =
    input.command ?? input.file_path ?? input.pattern ?? input.skill ?? input.iid ?? input.issue_iid ?? input.mr_iid ?? input.merge_request_iid ?? '';
  return `${name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '')} ${String(detail)}`.trim();
}

async function run<T>(
  role: ModelRole,
  prompt: string,
  schema: Schema,
  extra: Partial<Options> = {},
  shell: { rules: string[]; patterns: RegExp[] } = { rules: [], patterns: [] },
): Promise<Run<T>> {
  const sources: string[] = [];
  let sessionId = '';
  const q = query({
    prompt,
    options: {
      cwd: WORKSPACE,
      model: getSettings().models[role],
      env: agentEnv(),
      // dontAsk denies every tool that allowedTools does not pre-approve.
      permissionMode: 'dontAsk',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `${ROLE}\nPara ler o GitLab: ${GITLAB_HINT}` },
      allowedTools: [...allowedFor(role), ...shell.rules],
      disallowedTools: [
        ...(getSettings().tools.glab || shell.rules.length ? [] : ['Bash']),
        'Edit',
        'Write',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
        'Read(**/*.env)',
        'Read(**/.env*)',
        'Read(~/.config/**)',
        'Read(~/.ssh/**)',
        'Read(**/.mcp.json)',
      ],
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [shellAllowlist([...GLAB_READ, ...shell.patterns])] },
          { matcher: 'Read|Grep|Glob', hooks: [noSecrets] },
        ],
      },
      outputFormat: { type: 'json_schema', schema },
      maxTurns: 8,
      ...extra,
    },
  });
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    if (m.type === 'assistant') {
      for (const block of m.message.content) {
        if (block.type !== 'tool_use') continue;
        sources.push(source(block.name, block.input as Record<string, unknown>));
        if (process.env.CERIMONIAS_DEBUG) console.error('[tool]', block.name, JSON.stringify(block.input).slice(0, 300));
      }
    }
    if (process.env.CERIMONIAS_DEBUG && m.type === 'user' && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        if (block.type === 'tool_result' && block.is_error) console.error('[tool error]', JSON.stringify(block.content).slice(0, 300));
      }
    }
    if (m.type === 'result') {
      sessionId = m.session_id;
      if (m.subtype !== 'success' || m.structured_output == null) throw new Error(`agent ended with ${m.subtype}`);
      return { data: m.structured_output as T, sessionId, sources };
    }
  }
  throw new Error('agent ended without a result');
}

function cardContext(card: Card): string {
  const { spec, ...rest } = card;
  const where = spec ? `Spec em ${spec.folder} (${spec.phase}).` : 'Sem pasta de spec.';
  return `Cartão da atividade (GitLab via daily-report): ${JSON.stringify(rest)}\n${where}`;
}

export async function prepareTurn(card: Card): Promise<AgentTurn> {
  const prompt = [
    `Você é o agente da atividade ${card.ref} na pré-daily por voz.`,
    cardContext(card),
    'Se precisar, leia o spec (no máximo 3 leituras).',
    'Monte a sua vez: "fala" com até 60 palavras, dizendo o que mudou desde ontem, o próximo passo e o bloqueio.',
    'Se houver uma decisão que só o Luiz pode tomar, termine a fala com UMA pergunta objetiva e repita-a em "pergunta"; senão, "pergunta" é null.',
    SPEECH_RULES,
  ].join('\n');
  const schema = obj({ fala: str, andou: str, proximo: str, bloqueio: strOrNull, pergunta: strOrNull });
  const r = await run<{ fala: string; andou: string; proximo: string; bloqueio: string | null; pergunta: string | null }>(
    'turn',
    prompt,
    schema,
  );
  return {
    ref: card.ref,
    sessionId: r.sessionId || null,
    speech: r.data.fala,
    did: r.data.andou,
    next: r.data.proximo,
    blocker: r.data.bloqueio,
    question: r.data.pergunta,
  };
}

export async function reply(card: Card, turn: AgentTurn, text: string): Promise<ReplyResult> {
  const prompt = [
    turn.sessionId ? '' : `${cardContext(card)}\nSua fala foi: ${turn.speech}`,
    `O Luiz respondeu por voz (a transcrição pode ter erros): «${text}»`,
    '"ack": até 25 palavras confirmando o que você entendeu.',
    '"decisao": o que ficou decidido, ou null. "alvo": "spec" se muda escopo ou plano da issue e ela tem spec; "daily-report" se é lembrete pessoal sobre a atividade; "ata" no resto.',
    '"efeito": ação externa que o Luiz terá de executar depois com confirmação (push, MR, status, comentário, pipeline, reviewer, issue nova), ou null.',
    '"desbloqueio": true se ele pediu para aprofundar ou se a resposta pede investigação.',
    SPEECH_RULES,
  ].join('\n');
  const schema = obj({
    ack: str,
    decisao: { anyOf: [{ type: 'null' }, obj({ texto: str, alvo: { enum: ['spec', 'daily-report', 'ata'] } })] },
    efeito: { anyOf: [{ type: 'null' }, obj({ texto: str, repo: str })] },
    desbloqueio: { type: 'boolean' },
  });
  type Out = {
    ack: string;
    decisao: { texto: string; alvo: DecisionTarget } | null;
    efeito: { texto: string; repo: string } | null;
    desbloqueio: boolean;
  };
  const r = await run<Out>('reply', prompt, schema, { maxTurns: 3, ...(turn.sessionId ? { resume: turn.sessionId } : {}) });
  const target = r.data.decisao?.alvo === 'spec' && !card.spec ? 'ata' : r.data.decisao?.alvo;
  const decision: Decision | null =
    r.data.decisao && target ? { ref: card.ref, text: r.data.decisao.texto, target, dest: destination(card, target) } : null;
  return {
    ack: r.data.ack,
    decision,
    effect: r.data.efeito ? { ref: card.ref, text: r.data.efeito.texto, repo: r.data.efeito.repo } : null,
    needsDeepDive: r.data.desbloqueio,
  };
}

export async function deepAsk(card: Card, question: string, sessionId: string | null): Promise<DeepAnswer> {
  const prompt = [
    sessionId
      ? ''
      : `Desbloqueio por voz da atividade ${card.ref}. Investigue lendo spec, rules e GitLab (só leitura) antes de responder.\n${cardContext(card)}`,
    `Pergunta do Luiz (transcrição por voz): «${question}»`,
    '"fala": resposta em até 80 palavras, para ser ouvida.',
    SPEECH_RULES,
  ].join('\n');
  const r = await run<{ fala: string }>('deep', prompt, obj({ fala: str }), {
    maxTurns: 20,
    ...(sessionId ? { resume: sessionId } : {}),
  });
  return { sessionId: r.sessionId, speech: r.data.fala, sources: r.sources };
}

export async function deepOptions(card: Card, sessionId: string): Promise<DeepOption[]> {
  const prompt = [
    `Com base no que você investigou sobre ${card.ref}, proponha de 2 a 3 saídas para o bloqueio.`,
    'Cada uma: "titulo" curto, "consequencia" (o que acontece se o Luiz escolher), "efeito" (ação externa que exigirá confirmação, ou null), "decisao" (frase pronta para o Registro do Plan) e "recomendada" (só uma true).',
  ].join('\n');
  const option = obj({ titulo: str, consequencia: str, efeito: strOrNull, decisao: str, recomendada: { type: 'boolean' } });
  const r = await run<{ opcoes: { titulo: string; consequencia: string; efeito: string | null; decisao: string; recomendada: boolean }[] }>(
    'deep',
    prompt,
    obj({ opcoes: { type: 'array', items: option, minItems: 2, maxItems: 3 } }),
    { maxTurns: 4, resume: sessionId },
  );
  return r.data.opcoes.map((o) => ({
    title: o.titulo,
    consequence: o.consequencia,
    effect: o.efeito,
    decision: o.decisao,
    recommended: o.recomendada,
  }));
}

export async function teamsText(minutes: Minutes, cards: Card[]): Promise<string> {
  const prompt = [
    'Escreva o texto que o Luiz vai colar no Teams na daily do time, a partir da pré-daily abaixo.',
    'Estilo dele: "Bom dia, pessoal!", depois parágrafos "Ontem:", "Hoje:" e "Bloqueios:", frases curtas, links das issues quando ajudar, sem tabela, sem markdown além das quebras de linha.',
    `Atividades: ${JSON.stringify(cards.map((c) => ({ ref: c.ref, titulo: c.title, url: c.url, estagio: c.stage, bloqueios: c.blockers, mudou: c.changes })))}`,
    `Decisões: ${JSON.stringify(minutes.decisions)}`,
    `Efeitos pendentes: ${JSON.stringify(minutes.effects)}`,
  ].join('\n');
  const r = await run<{ texto: string }>('teams', prompt, obj({ texto: str }), { maxTurns: 2 });
  return r.data.texto;
}

export async function rewriteQaComment(issue: number, current: string, syncOutput: string, unit: Record<string, unknown> | null): Promise<{ body: string; summary: string }> {
  const prompt = [
    `A issue sz4#${issue} foi sincronizada com a main depois de uma release. Reescreva o comentário de pipelines do QA abaixo, que vai ser editado no lugar.`,
    'Regras (skill post-release-sync, "Convivência com o comentário do qa-release-branch"): mantenha o texto, a menção @qa.interno e o formato;',
    'troque o link da pipeline pela pipeline de PUSH do commit de merge (consulte com glab api projects/<grupo%2Frepo>/pipelines?ref=<branch>);',
    'acrescente uma linha dizendo que a branch foi sincronizada com a main e se precisa de reteste, citando os arquivos sobrepostos quando houver.',
    'Não invente pipeline: se não achar a de push do commit de merge, mantenha a atual e diga isso no resumo.',
    `Saída do sync:\n${syncOutput.slice(-4000)}`,
    `Unidade da ferramenta: ${JSON.stringify(unit ?? {}).slice(0, 4000)}`,
    `Comentário atual:\n${current}`,
    '"body": o comentário completo, pronto para substituir o atual. "resumo": uma frase dizendo o que mudou.',
  ].join('\n');
  const r = await run<{ body: string; resumo: string }>('deep', prompt, obj({ body: str, resumo: str }), { maxTurns: 12 });
  return { body: r.data.body, summary: r.data.resumo };
}

export async function conflictAsk(context: string, question: string, sessionId: string | null): Promise<DeepAnswer> {
  const prompt = [
    sessionId
      ? ''
      : [
          'Call sobre um conflito de sincronização com a main depois de uma release. Você explica; não resolve nada aqui.',
          'Leia os dois lados no mirror da ferramenta (git -C <repo> merge-tree/diff/show/log, só leitura) e a skill post-release-sync, seção "Conflito: resolução manual".',
          'Explique: o que cada lado mudou, por que conflita e a resolução que você propõe (qual lado fica em cada trecho e o que testar depois).',
          'O ajuste será feito depois no Claude Code, numa worktree temporária, com confirmação do Luiz.',
          context,
        ].join('\n'),
    `Pergunta do Luiz (transcrição por voz): «${question}»`,
    '"fala": resposta em até 90 palavras, para ser ouvida.',
    SPEECH_RULES,
  ].join('\n');
  const r = await run<{ fala: string }>(
    'deep',
    prompt,
    obj({ fala: str }),
    { maxTurns: 20, ...(sessionId ? { resume: sessionId } : {}) },
    { rules: ['Bash(git -C:*)'], patterns: GIT_MIRROR_READ },
  );
  return { sessionId: r.sessionId, speech: r.data.fala, sources: r.sources };
}

// Structured agent call for the other ceremony modules (gate, QA handoff, retro).
export { run as askAgent, obj, str, strOrNull, SPEECH_RULES };
