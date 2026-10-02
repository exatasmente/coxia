import { type Options, query } from '@anthropic-ai/claude-agent-sdk';
import { destination } from '../shared/destination';
import type { AgentTurn, Card, DeepAnswer, DeepOption, Decision, DecisionTarget, Minutes, ReplyResult } from '../shared/types';
import { MODEL, WORKSPACE, agentEnv } from './env';

const READ_ONLY = [
  'Read',
  'Grep',
  'Glob',
  'Skill',
  'mcp__gitlab-issue-analysis__get_issue_details_and_comments',
  'mcp__gitlab-issue-analysis__get_merge_request_details_and_changes',
];

const SPEECH_RULES =
  'Português do Brasil falado: frases curtas, sem markdown, sem listas, sem emoji. ' +
  'Issue pelo número curto ("a 15499"), MR pelo repositório e número ("o 797 do hub-whatsapp"). ' +
  'Fale só o que está no cartão ou no que você leu nesta sessão; não deduza causa técnica nem invente estado.';

const ROLE =
  'Você participa de uma cerimônia por voz do Luiz como agente de uma atividade. ' +
  'A cerimônia é somente leitura: não edite arquivos, não rode comandos, não publique nada. ' +
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
  const detail = input.file_path ?? input.pattern ?? input.skill ?? input.iid ?? input.issue_iid ?? input.merge_request_iid ?? '';
  return `${name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '')} ${String(detail)}`.trim();
}

async function run<T>(prompt: string, schema: Schema, extra: Partial<Options> = {}): Promise<Run<T>> {
  const sources: string[] = [];
  let sessionId = '';
  const q = query({
    prompt,
    options: {
      cwd: WORKSPACE,
      model: MODEL,
      env: agentEnv(),
      // dontAsk denies every tool that allowedTools does not pre-approve.
      permissionMode: 'dontAsk',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ROLE },
      allowedTools: READ_ONLY,
      disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch'],
      outputFormat: { type: 'json_schema', schema },
      maxTurns: 8,
      ...extra,
    },
  });
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    if (m.type === 'assistant') {
      for (const block of m.message.content) {
        if (block.type === 'tool_use') sources.push(source(block.name, block.input as Record<string, unknown>));
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
  const r = await run<Out>(prompt, schema, { maxTurns: 3, ...(turn.sessionId ? { resume: turn.sessionId } : {}) });
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
  const r = await run<{ fala: string }>(prompt, obj({ fala: str }), {
    maxTurns: 20,
    allowedTools: [...READ_ONLY, 'Agent'],
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
  const r = await run<{ texto: string }>(prompt, obj({ texto: str }), { maxTurns: 2, allowedTools: [] });
  return r.data.texto;
}
