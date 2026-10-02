import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { type HookCallback, type Options, query } from '@anthropic-ai/claude-agent-sdk';
import { destination } from '../shared/destination';
import type { AgentTurn, Card, DeepAnswer, DeepOption, Decision, DecisionTarget, Minutes, ReplyResult } from '../shared/types';
import type { ModelRole } from '../shared/settings';
import { getSettings } from './config';
import { ATAS, GITLAB, WORKSPACE, agentEnv } from './env';
import { cardFingerprint, rememberTurn, reusableTurn } from './falas';
import { CLAUDE_BIN } from './paths';
import { noteSession } from './sessions';
import { openEngineFromEnv, runOpenOnce } from './engine/open';

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
    if (patterns.some((re) => re.test(command)) && !(command.startsWith('git ') && command.split(/[\s:"']+/).some((t) => SECRET_PATH.test(t)))) {
      return {};
    }
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
// A name with secret/credential/token only counts when the file is not source code: TokenService.php and secret.service.ts
// are code, token.json and config/secrets.yml are data. Anything else with such a name (no extension, .bak, .md) is held back.
const CODE_EXT = [
  'php', 'phtml', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'go', 'java', 'kt', 'kts', 'dart', 'rb', 'cs', 'rs', 'swift',
  'c', 'h', 'cc', 'cpp', 'hpp', 'scala', 'ex', 'exs', 'lua', 'pl', 'sh', 'html', 'css', 'scss', 'less',
];
const SECRET_NAME = '(?=[\\s\\S]*(?:secret|credential|token))(?![\\s\\S]*\\.(?:' + CODE_EXT.join('|') + ')$)';
const SECRET_KEYS = '(?:^|\\/)(?:\\.env(?:rc)?(?:$|[./*?])|\\.(?:ssh|config|aws|docker)(?:$|\\/)|\\.(?:netrc|npmrc|pypirc)$|id_(?:rsa|dsa|ecdsa|ed25519)[^/]*$)|\\.env$|(?:^|[\\/_.-])key$|\\.(?:pem|p12|pfx)$|\\.mcp\\.json$|\\.claude\\.json$';
const NAME_RULE = new RegExp(`^${SECRET_NAME}`, 'i');
const KEY_RULE = new RegExp(SECRET_KEYS, 'i');
export const SECRET_PATH = new RegExp(`${NAME_RULE.source}|${KEY_RULE.source}`, 'i');

// SECRET_PATH in gitignore syntax. Read deny rules are the layer that also reaches a Grep or Glob with no path
// (the SDK turns them into case-insensitive ripgrep ignores placed after any glob the model passes); a hook never
// sees what a path-less search will walk. A glob cannot say "unless it is code", so the name rules list the data
// extensions; the hook and the result filter apply the full rule. The ~/ rules cover the home, outside the cwd.
const SECRET_WORDS = ['secret', 'credential', 'token'];
const DATA_EXT = ['json', 'yml', 'yaml', 'txt', 'ini', 'cfg', 'conf', 'toml', 'properties', 'xml'];
export const SECRET_GLOBS = [
  '**/.env*',
  '**/*.env',
  ...SECRET_WORDS.flatMap((w) => DATA_EXT.map((e) => `**/*${w}*.${e}`)),
  '**/.git-credentials',
  '**/key',
  '**/*_key',
  '**/*-key',
  '**/*.key',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa*',
  '**/id_dsa*',
  '**/id_ecdsa*',
  '**/id_ed25519*',
  '**/.ssh/**',
  '**/.config/**',
  '**/.aws/**',
  '**/.docker/**',
  '**/.netrc',
  '**/.npmrc',
  '**/.pypirc',
  '**/.mcp.json',
  '**/.claude.json',
  '~/.ssh/**',
  '~/.config/**',
  '~/.aws/**',
  '~/.docker/**',
  '~/.netrc',
  '~/.npmrc',
  '~/.pypirc',
  '~/.claude.json',
  '~/.claude/*.json',
  '~/.claude/projects/**',
];
export const SECRET_READ_DENY = SECRET_GLOBS.map((g) => `Read(${g})`);

// The Claude Code state in the home holds settings with keys and the transcript of every session.
function inClaudeState(p: string): boolean {
  const base = `${homedir()}/.claude/`;
  if (!p.startsWith(base)) return false;
  const rel = p.slice(base.length);
  return rel.startsWith('projects/') || (!rel.includes('/') && rel.endsWith('.json'));
}

// The path as written, with ~ expanded, absolute against the cwd and with symlinks resolved:
// a link named notes.txt that points at a .env is the .env.
export function secretPath(p: string, cwd = process.cwd()): boolean {
  const home = p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p;
  const abs = isAbsolute(home) ? home : resolve(cwd, home);
  const forms = [p, home, abs];
  try {
    forms.push(realpathSync(abs));
  } catch {
    // does not exist: the written forms are all there is
  }
  const dir = isDirectory(abs);
  return forms.some((f) => inClaudeState(f) || KEY_RULE.test(f) || (NAME_RULE.test(f) && !dir));
}

// A directory named tokens/ has no extension to tell code from data: it can be searched, and the results are judged file by file.
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export const noSecrets: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  const args = input.tool_input as { file_path?: unknown; path?: unknown; pattern?: unknown; glob?: unknown };
  const paths = [args.file_path, args.path, input.tool_name === 'Glob' ? args.pattern : null, args.glob].filter(
    (p): p is string => typeof p === 'string',
  );
  if (!paths.some((p) => secretPath(p, input.cwd))) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Arquivo de configuração ou segredo: fora do alcance da cerimônia.',
    },
  };
};

// Last layer for Grep and Glob: whatever the deny rules let through, a result that names a secret file is cut.
export function withoutSecretFiles(response: unknown, cwd?: string): object | null {
  if (typeof response !== 'object' || response === null) return null;
  const out = response as { filenames?: unknown; content?: unknown };
  const names = Array.isArray(out.filenames) ? (out.filenames as unknown[]) : null;
  const keptNames = names?.filter((n) => typeof n !== 'string' || !secretPath(n, cwd));
  const lines = typeof out.content === 'string' ? out.content.split('\n') : null;
  // A match line is "path:line:text" (context lines "path-line-text"); a file name may hold ':' or '-', so every
  // "[:-]digits[:-]" is tried as the end of the path.
  const keptLines = lines?.filter((l) => {
    for (const m of l.matchAll(/[:-]\d+[:-]/g)) {
      const file = l.slice(0, m.index);
      if (!/\s/.test(file) && secretPath(file, cwd)) return false;
    }
    return true;
  });
  if (keptNames?.length === names?.length && keptLines?.length === lines?.length) return null;
  return {
    ...out,
    ...(keptNames ? { filenames: keptNames, numFiles: keptNames.length } : {}),
    ...(keptLines ? { content: keptLines.join('\n') } : {}),
  };
}

export const redactSecretResults: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PostToolUse' || !/^(Grep|Glob)$/.test(input.tool_name)) return {};
  const clean = withoutSecretFiles(input.tool_response, input.cwd);
  if (!clean) return {};
  if (process.env.CERIMONIAS_DEBUG) console.error('[redacted]', input.tool_name);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: clean } };
};

export function agentHooks(patterns: RegExp[] = []): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [
      { matcher: 'Bash', hooks: [shellAllowlist([...GLAB_READ, ...patterns])] },
      { matcher: 'Read|Grep|Glob', hooks: [noSecrets] },
    ],
    PostToolUse: [{ matcher: 'Grep|Glob', hooks: [redactSecretResults] }],
  };
}

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

// The chat is read, not heard: it completes the speech instead of repeating it.
const CHAT_RULES =
  '"texto": a mesma resposta para ler no chat, completa: pode ter listas curtas, `arquivo:linha`, comandos e os detalhes que não cabem na fala. ' +
  'Quando um fluxo, uma sequência entre serviços ou a relação entre partes ficar mais clara desenhada, inclua um diagrama em bloco ```mermaid ' +
  '(flowchart ou sequenceDiagram, rótulos curtos e entre aspas quando tiverem símbolos, sem estilos nem cores). Sem diagrama quando não ajudar. ' +
  '"fala": a versão para ser ouvida, que segue as regras de fala abaixo e não lê o diagrama.';

const ROLE =
  'Você participa de uma cerimônia por voz do Luiz como agente de uma atividade. ' +
  'A cerimônia é somente leitura: não edite arquivos, não publique nada; no terminal, só leitura do GitLab. ' +
  'Toda ação com efeito externo vira item da ata para o Luiz executar depois, com confirmação.';

interface Run<T> {
  data: T;
  sessionId: string;
  sources: string[];
  // The agent ran out of turns and answered from what it had already read.
  partial?: true;
}

class MaxTurnsError extends Error {
  constructor(
    readonly sessionId: string,
    readonly sources: string[],
  ) {
    super('agent ended with error_max_turns');
  }
}

const WRAP_UP =
  'Acabaram as chamadas de ferramenta: você não pode ler nem pesquisar mais nada. Responda agora, no formato JSON pedido, ' +
  'com o que você já sabe e leu nesta sessão. Diga na própria resposta o que você não conseguiu conferir; não invente o que faltou.';

type Schema = Record<string, unknown>;

const str = { type: 'string' };
// Up to three ready-made replies: in the call the person may tap one instead of speaking.
const OPTIONS = { type: 'array', items: { type: 'string' }, maxItems: 3 };
const OPTIONS_RULE =
  '"opcoes": de 0 a 3 respostas prontas, curtas (até 12 palavras), escritas como o Luiz responderia, cada uma uma saída concreta ' +
  '(ex.: "Pode seguir com o merge", "Pede ajuda ao QA hoje", "Deixa para amanhã"). Lista vazia quando não há nada a decidir.';

function options(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim().slice(0, 120)).slice(0, 3) : [];
}
const strOrNull = { type: ['string', 'null'] };

function obj(properties: Record<string, unknown>): Schema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function source(name: string, input: Record<string, unknown>): string {
  const detail =
    input.command ?? input.file_path ?? input.pattern ?? input.skill ?? input.iid ?? input.issue_iid ?? input.mr_iid ?? input.merge_request_iid ?? '';
  return `${name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '')} ${String(detail)}`.trim();
}

async function runOnce<T>(
  role: ModelRole,
  prompt: string,
  schema: Schema,
  extra: Partial<Options> = {},
  shell: { rules: string[]; patterns: RegExp[] } = { rules: [], patterns: [] },
): Promise<Run<T>> {
  const sources: string[] = [];
  let sessionId = '';
  // Test hook (COXIA_ENGINE=open): the same call on the open engine, an agent loop over an OpenAI-compatible API, with no OpenRouter key read.
  const open = openEngineFromEnv();
  const options: Options = {
      cwd: WORKSPACE,
      model: getSettings().models[role],
      ...(open ? {} : { env: agentEnv() }),
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
        ...SECRET_READ_DENY,
      ],
      hooks: agentHooks(shell.patterns),
      outputFormat: { type: 'json_schema', schema },
      maxTurns: 8,
      ...(CLAUDE_BIN ? { pathToClaudeCodeExecutable: CLAUDE_BIN } : {}),
      ...extra,
  };
  if (open) {
    return runOpenOnce<T>({
      selection: open,
      prompt,
      options,
      sessionsDir: join(ATAS, 'open-sessions'),
      secret: { isSecret: (p) => secretPath(p, WORKSPACE), globs: SECRET_GLOBS },
      shellEnv: { GITLAB_HOST: GITLAB },
      describeTool: source,
      events: { onSession: (id) => noteSession(id, role, prompt) },
      makeMaxTurnsError: (id, src) => new MaxTurnsError(id, src),
    });
  }
  const q = query({ prompt, options });
  for await (const m of q) {
    if ('session_id' in m) noteSession(m.session_id, role, prompt);
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
      if (m.subtype === 'error_max_turns') throw new MaxTurnsError(sessionId, sources);
      if (m.subtype !== 'success' || m.structured_output == null) throw new Error(`agent ended with ${m.subtype}`);
      return { data: m.structured_output as T, sessionId, sources };
    }
  }
  throw new Error('agent ended without a result');
}

// An agent that runs out of turns is resumed once, without tools, to answer with what it has; that answer is marked partial.
// The resume stays in the same session transcript, which is what the cost panel reads, so its generations are counted.
async function run<T>(
  role: ModelRole,
  prompt: string,
  schema: Schema,
  extra: Partial<Options> = {},
  shell: { rules: string[]; patterns: RegExp[] } = { rules: [], patterns: [] },
): Promise<Run<T>> {
  try {
    return await runOnce<T>(role, prompt, schema, extra, shell);
  } catch (e) {
    if (!(e instanceof MaxTurnsError)) throw e;
    const stopped = `O agente parou antes de terminar (limite de passos) e não deu uma resposta final${e.sessionId ? '' : ' nem deixou sessão para retomar'}.`;
    if (!e.sessionId) throw new Error(stopped);
    console.error('[agent] error_max_turns, resuming once for a partial answer', e.sessionId);
    try {
      const r = await runOnce<T>(role, WRAP_UP, schema, { ...extra, resume: e.sessionId, maxTurns: 2, tools: [], allowedTools: [] }, { rules: [], patterns: shell.patterns });
      return { ...r, sources: [...e.sources, ...r.sources], partial: true };
    } catch (again) {
      console.error('[agent] partial answer failed', again instanceof Error ? again.message : again);
      throw new Error(`${stopped} A tentativa de resposta parcial também falhou (${again instanceof Error ? again.message : String(again)}).`);
    }
  }
}

// The model sometimes answers the literal string "null" (or "nenhum") instead of JSON null.
export function nullish(value: string | null): string | null {
  const v = value?.trim() ?? '';
  return !v || /^(null|none|nenhum|nenhuma|n\/a|-)\.?$/i.test(v) ? null : v;
}

function cardContext(card: Card): string {
  const { spec, ...rest } = card;
  const where = spec ? `Spec em ${spec.folder} (${spec.phase}).` : 'Sem pasta de spec.';
  return `Cartão da atividade (GitLab via daily-report): ${JSON.stringify(rest)}\n${where}`;
}

export async function prepareTurn(card: Card): Promise<AgentTurn> {
  const same = reusableTurn(card);
  if (same) return same;
  const fp = cardFingerprint(card);
  const prompt = [
    `Você é o agente da atividade ${card.ref} na pré-daily por voz.`,
    cardContext(card),
    'Se precisar, leia o spec (no máximo 3 leituras).',
    'Monte a sua vez: "fala" com até 60 palavras, dizendo o que mudou desde ontem, o próximo passo e o bloqueio.',
    'Se houver uma decisão que só o Luiz pode tomar, termine a fala com UMA pergunta objetiva e repita-a em "pergunta"; senão, "pergunta" é null.',
    `${OPTIONS_RULE} Ofereça opções quando houver pergunta ou bloqueio.`,
    SPEECH_RULES,
  ].join('\n');
  const schema = obj({ fala: str, andou: str, proximo: str, bloqueio: strOrNull, pergunta: strOrNull, opcoes: OPTIONS });
  const r = await run<{ fala: string; andou: string; proximo: string; bloqueio: string | null; pergunta: string | null; opcoes: string[] }>(
    'turn',
    prompt,
    schema,
  );
  const turn: AgentTurn = {
    ref: card.ref,
    sessionId: r.sessionId || null,
    speech: r.data.fala,
    did: r.data.andou,
    next: r.data.proximo,
    blocker: nullish(r.data.bloqueio),
    question: nullish(r.data.pergunta),
    options: options(r.data.opcoes),
  };
  rememberTurn(card, turn, fp);
  return turn;
}

export async function reply(card: Card, turn: AgentTurn, text: string): Promise<ReplyResult> {
  const prompt = [
    turn.sessionId ? '' : `${cardContext(card)}\nSua fala foi: ${turn.speech}`,
    `O Luiz respondeu por voz (a transcrição pode ter erros): «${text}»`,
    '"ack": até 25 palavras confirmando o que você entendeu.',
    '"decisao": o que ficou decidido, ou null. "alvo": "spec" se muda escopo ou plano da issue e ela tem spec; "daily-report" se é lembrete pessoal sobre a atividade; "ata" no resto.',
    '"efeito": ação externa que o Luiz terá de executar depois com confirmação (push, MR, status, comentário, pipeline, reviewer, issue nova), ou null.',
    '"desbloqueio": true se ele pediu para aprofundar ou se a resposta pede investigação.',
    `${OPTIONS_RULE} Aqui, próximos passos possíveis depois desta resposta.`,
    SPEECH_RULES,
  ].join('\n');
  const schema = obj({
    ack: str,
    decisao: { anyOf: [{ type: 'null' }, obj({ texto: str, alvo: { enum: ['spec', 'daily-report', 'ata'] } })] },
    efeito: { anyOf: [{ type: 'null' }, obj({ texto: str, repo: str })] },
    desbloqueio: { type: 'boolean' },
    opcoes: OPTIONS,
  });
  type Out = {
    ack: string;
    decisao: { texto: string; alvo: DecisionTarget } | null;
    efeito: { texto: string; repo: string } | null;
    desbloqueio: boolean;
    opcoes: string[];
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
    options: options(r.data.opcoes),
  };
}

export async function deepAsk(card: Card, question: string, sessionId: string | null): Promise<DeepAnswer> {
  const prompt = [
    sessionId
      ? ''
      : `Desbloqueio por voz da atividade ${card.ref}. Investigue lendo spec, rules e GitLab (só leitura) antes de responder.\n${cardContext(card)}`,
    `Pergunta do Luiz (transcrição por voz): «${question}»`,
    '"fala": resposta em até 80 palavras, para ser ouvida.',
    CHAT_RULES,
    SPEECH_RULES,
  ].join('\n');
  const r = await run<{ fala: string; texto: string }>('deep', prompt, obj({ fala: str, texto: str }), {
    maxTurns: 20,
    ...(sessionId ? { resume: sessionId } : {}),
  });
  return { sessionId: r.sessionId, speech: r.data.fala, text: r.data.texto || r.data.fala, sources: r.sources, ...(r.partial ? { partial: true } : {}) };
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
          'Seja econômico: comece pelo merge-tree dos arquivos em conflito e pelo diff de cada lado só nesses arquivos; no máximo umas 10 leituras antes de responder. Na dúvida, responda com o que já sabe e diga o que falta conferir.',
          'O ajuste será feito depois no Claude Code, numa worktree temporária, com confirmação do Luiz.',
          context,
        ].join('\n'),
    `Pergunta do Luiz (transcrição por voz): «${question}»`,
    '"fala": resposta em até 90 palavras, para ser ouvida.',
    CHAT_RULES,
    SPEECH_RULES,
  ].join('\n');
  const r = await run<{ fala: string; texto: string }>(
    'deep',
    prompt,
    obj({ fala: str, texto: str }),
    { maxTurns: 40, ...(sessionId ? { resume: sessionId } : {}) },
    { rules: ['Bash(git -C:*)'], patterns: GIT_MIRROR_READ },
  );
  return { sessionId: r.sessionId, speech: r.data.fala, text: r.data.texto || r.data.fala, sources: r.sources, ...(r.partial ? { partial: true } : {}) };
}

export interface ProposeHunk {
  id: string;
  file: string;
  ours: string;
  base: string | null;
  theirs: string;
}

export interface Proposal {
  summary: string;
  items: { id: string; resolution: string; explanation: string; confidence: 'alta' | 'media' | 'baixa'; test: string }[];
  // The agent ran out of turns on this batch and proposed from what it had read.
  partial?: boolean;
}

const SIDE_MAX = 12_000;
// One call per batch: a batch is the hunks of one file, split when their text passes BATCH_CHARS.
const BATCH_CHARS = 24_000;
const BATCH_PARALLEL = 3;
const PROMPT_MAX = 40_000;

function clip(text: string | null, left: { n: number }): string {
  if (text === null) return '(sem ancestral comum)';
  const max = Math.min(SIDE_MAX, Math.max(left.n, 400));
  left.n -= Math.min(text.length, max);
  return text.length > max ? `${text.slice(0, max)}\n… (cortado em ${max} de ${text.length} caracteres: leia o arquivo na worktree)` : text;
}

type ProposeInput = { issue: number; title: string; mr: string; branch: string; worktree: string; hunks: ProposeHunk[] };

const hunkChars = (h: ProposeHunk) => h.ours.length + h.theirs.length + (h.base?.length ?? 0);

export function proposeBatches(hunks: ProposeHunk[]): ProposeHunk[][] {
  const batches: ProposeHunk[][] = [];
  for (const file of [...new Set(hunks.map((h) => h.file))]) {
    let batch: ProposeHunk[] = [];
    let size = 0;
    for (const h of hunks.filter((x) => x.file === file)) {
      if (batch.length && size + hunkChars(h) > BATCH_CHARS) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(h);
      size += hunkChars(h);
    }
    if (batch.length) batches.push(batch);
  }
  return batches;
}

// Many conflicts in one call made the agent read files to recover clipped text and run out of turns:
// each batch goes alone, a few at a time, and a failed batch only leaves its own hunks without a proposal.
export async function conflictPropose(p: ProposeInput): Promise<Proposal & { failed: string[]; partialIds: string[] }> {
  if (!p.hunks.length) return { summary: 'Nenhum trecho em conflito.', items: [], failed: [], partialIds: [] };
  const batches = proposeBatches(p.hunks);
  const results: (Proposal | null)[] = new Array(batches.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      try {
        results[i] = await proposeBatch({ ...p, hunks: batches[i] });
      } catch (e) {
        console.error('[conflict:propose]', batches[i][0]?.file, (e as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_PARALLEL, batches.length) }, worker));
  const failed = batches.flatMap((b, i) => (results[i] ? [] : b.map((h) => h.id)));
  if (failed.length === p.hunks.length) throw new Error('o agente não conseguiu propor nenhum trecho; tente de novo');
  const summaries = results.filter((r): r is Proposal => !!r).map((r) => r.summary.trim()).filter(Boolean);
  return {
    summary: [summaries.length > 1 ? summaries.map((x, i) => `${i + 1}. ${x}`).join(' ') : summaries[0] ?? '', failed.length ? `${failed.length} trecho(s) ficaram sem proposta: peça de novo.` : ''].filter(Boolean).join(' '),
    items: results.flatMap((r) => r?.items ?? []),
    failed,
    partialIds: batches.flatMap((b, i) => (results[i]?.partial ? b.map((h) => h.id) : [])),
  };
}

async function proposeBatch(p: ProposeInput): Promise<Proposal> {
  const left = { n: PROMPT_MAX };
  const blocks = p.hunks.map((h) =>
    [`### trecho ${h.id}`, `arquivo: ${h.file}`, '--- BRANCH (ours) ---', clip(h.ours, left), '--- BASE ---', clip(h.base, left), '--- MAIN (theirs) ---', clip(h.theirs, left)].join('\n'),
  );
  const prompt = [
    `Conflito de sincronização com a main depois de uma release: issue sz4#${p.issue} (${p.title}), ${p.mr}, branch ${p.branch}.`,
    'Para cada trecho em conflito abaixo, proponha o texto final (sem marcadores de conflito). BRANCH é o que o MR escreveu; MAIN é o que a release trouxe; BASE é o ancestral comum (quando houver).',
    'O conflito típico pós-release é COMPLEMENTAR: os dois lados acrescentaram coisas diferentes no mesmo trecho, e a resolução é combinar os dois. Mantenha o que cada lado fez; ajuste só o necessário para os dois conviverem (ordem, vírgulas, imports).',
    'Nunca invente código além de combinar ou adaptar os dois lados. Se os lados são incompatíveis e a combinação exigiria inventar, escolha um lado inteiro, diga qual e marque confianca "baixa".',
    `Os arquivos com marcadores estão na worktree ${p.worktree}. Leia um arquivo só se um trecho abaixo estiver cortado ou se o contexto ao redor for indispensável: no máximo 3 leituras.`,
    '"resolucao": o texto exato que fica no lugar do trecho, com a indentação e as quebras de linha do arquivo, sem cerca de código, sem marcadores.',
    '"explicacao": um parágrafo curto em português dizendo o que cada lado fez e por que a resolução é essa. "confianca": alta, media ou baixa. "testar": o que testar depois (uma frase).',
    '"resumo": uma ou duas frases sobre o conflito como um todo. Devolva um item para cada id, com o id exatamente como está.',
    ...blocks,
  ].join('\n\n');
  const item = obj({ id: str, resolucao: str, explicacao: str, confianca: { enum: ['alta', 'media', 'baixa'] }, testar: str });
  const r = await run<{ resumo: string; trechos: { id: string; resolucao: string; explicacao: string; confianca: 'alta' | 'media' | 'baixa'; testar: string }[] }>(
    'deep',
    prompt,
    obj({ resumo: str, trechos: { type: 'array', items: item } }),
    { maxTurns: 12, additionalDirectories: [p.worktree] },
  );
  return {
    summary: r.data.resumo,
    ...(r.partial ? { partial: true } : {}),
    items: r.data.trechos.map((t) => ({ id: t.id, resolution: t.resolucao, explanation: t.explicacao, confidence: t.confianca, test: t.testar })),
  };
}

// Structured agent call for the other ceremony modules (gate, QA handoff, retro).
export { run as askAgent, obj, str, strOrNull, SPEECH_RULES, CHAT_RULES };
