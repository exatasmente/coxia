import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Card, GateOption, GateRoundView, GateView } from '../shared/types';
import { SPEECH_RULES, askAgent, obj, str } from './agents';
import { ATAS, SPECS } from './env';

// Quiz mechanics from the agent-pipeline skill, §2.1. The correct answers never leave this module before a round is answered.

interface Question {
  text: string;
  kind: string;
  options: string[];
  correct: number;
  section: string;
  explanation: string;
}

interface Answer {
  choice: number | null;
  other: string | null;
  correct: boolean;
  comment: string;
}

interface Round {
  questions: Question[];
  answers: (Answer | null)[];
  visual: GateRoundView['visual'];
}

interface Gate {
  id: string;
  ref: string;
  iid: string;
  title: string;
  gate: 1 | 2;
  label: string;
  artifact: string;
  quizFile: string;
  summary: string;
  sessionId: string | null;
  rounds: Round[];
  talk: { me: boolean; text: string; at: string }[];
  recorded: string | null;
  createdAt: string;
}

const DIR = join(ATAS, 'gates');
const ID = /^[\w-]+$/;
export const LETTERS = ['A', 'B', 'C', 'D'];
const KINDS = ['previsão', 'contrafactual', 'fronteira', 'side effect', 'rollback', 'regressão'];

const CANDIDATES: { sub: string; gate: 1 | 2; files: [string, string][] }[] = [
  { sub: 'bug', gate: 1, files: [['1_INVESTIGATION.md', 'Investigation']] },
  { sub: 'bug', gate: 2, files: [['2_PLAN.md', 'Plan']] },
  { sub: 'feat', gate: 1, files: [['1_SPEC_FUNCIONAL.md', 'Spec Funcional'], ['0_RFC.md', 'RFC']] },
  { sub: 'feat', gate: 2, files: [['3_PLAN.md', 'Plan']] },
  { sub: 'investigation', gate: 1, files: [['1_FINDINGS.md', 'Findings']] },
];

function now(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function read(id: string): Gate {
  if (!ID.test(id)) throw new Error('gate inválido');
  return JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')) as Gate;
}

function write(g: Gate): Gate {
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${g.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(g, null, 1));
  renameSync(`${file}.tmp`, file);
  return g;
}

function view(g: Gate): GateView {
  return {
    ...g,
    rounds: g.rounds.map((r) => {
      const done = r.answers.every(Boolean);
      return {
        visual: r.visual,
        verdict: done ? (r.answers.every((a) => a?.correct) ? 'assertivo' : 'não assertivo') : null,
        questions: r.questions.map((q, i) => ({
          text: q.text,
          kind: q.kind,
          options: q.options,
          answer: r.answers[i],
          correct: done ? q.correct : null,
          section: done ? q.section : null,
          explanation: done ? q.explanation : null,
        })),
      };
    }),
  };
}

export function gateOptions(card: Card): GateOption[] {
  if (!card.spec) return [];
  const folder = card.spec.folder;
  return CANDIDATES.flatMap((c) => {
    const hit = c.files.find(([f]) => existsSync(join(folder, c.sub, f)));
    return hit ? [{ gate: c.gate, label: hit[1], file: join(folder, c.sub, hit[0]) }] : [];
  });
}

const QUESTION = obj({
  pergunta: str,
  tipo: { enum: KINDS },
  opcoes: { type: 'array', items: str, minItems: 4, maxItems: 4 },
  correta: { type: 'integer', minimum: 0, maximum: 3 },
  secao: str,
  explicacao: str,
});

export type RawQuestion = { pergunta: string; tipo: string; opcoes: string[]; correta: number; secao: string; explicacao: string };

// Models tend to put the right option first; the order is shuffled here so the letter carries no hint.
export function toQuestion(q: RawQuestion, random: () => number = Math.random): Question {
  const order = q.opcoes.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    text: q.pergunta,
    kind: q.tipo,
    options: order.map((i) => q.opcoes[i]),
    correct: order.indexOf(q.correta),
    section: q.secao,
    // The explanation may cite the original letter; letters are dropped so it stays true after shuffling.
    explanation: q.explicacao.replace(/\b(?:op[cç][aã]o|letra|alternativa)\s+[A-D]\b/gi, 'a opção certa'),
  };
}

const QUIZ_RULES = [
  'Regras do quiz (agent-pipeline §2.1): até 3 perguntas de CONSEQUÊNCIA (previsão, contrafactual, fronteira, side effect, rollback, regressão), nunca fato localizável por busca;',
  'cada uma com 4 opções plausíveis e uma certa; os distratores saem de leituras erradas reais do artefato; nunca "todas as anteriores", nunca absurdo de propósito;',
  'com mais de 3 pontos de risco, escolha os 3 de maior consequência. Em "secao" cite arquivo + heading exato onde a resposta mora; em "explicacao", por que a certa é a certa (2 frases).',
].join('\n');

export async function startGate(card: Card, gate: 1 | 2): Promise<GateView> {
  const option = gateOptions(card).find((o) => o.gate === gate);
  if (!option) throw new Error(`a #${card.iid} não tem artefato para o Gate ${gate}`);
  const prompt = [
    `Gate ${gate} da issue ${card.ref} (${card.title}), por voz. Leia o artefato ${option.file} inteiro (e o que ele citar, se precisar).`,
    '"resumo": o Resumo do gate para ser ouvido, até 150 palavras: o que o artefato conclui ou propõe, os riscos e o que o Luiz está aprovando.',
    '"perguntas": o quiz.',
    QUIZ_RULES,
    SPEECH_RULES,
  ].join('\n');
  const r = await askAgent<{ resumo: string; perguntas: RawQuestion[] }>(
    'deep',
    prompt,
    obj({ resumo: str, perguntas: { type: 'array', items: QUESTION, minItems: 1, maxItems: 3 } }),
    { maxTurns: 16 },
  );
  const g: Gate = {
    id: `${card.iid}-gate${gate}-${Date.now().toString(36)}`,
    ref: card.ref,
    iid: card.iid,
    title: card.title,
    gate,
    label: option.label,
    artifact: option.file,
    quizFile: join(dirname(option.file), 'GATE_QUIZ.md'),
    summary: r.data.resumo,
    sessionId: r.sessionId || null,
    rounds: [{ questions: r.data.perguntas.map((q) => toQuestion(q)), answers: r.data.perguntas.map(() => null), visual: null }],
    talk: [],
    recorded: null,
    createdAt: new Date().toISOString(),
  };
  return view(write(g));
}

export function getGate(id: string): GateView | null {
  try {
    return view(read(id));
  } catch {
    return null;
  }
}

// "B", "letra b", "opção c", "a d"… → index; anything else is a free answer, which is evaluated, not accepted.
export function letter(text: string): number | null {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').trim();
  // The letter must be the whole answer: "a resposta está no cache" starts with the article "a", not with option A.
  const m = /^(?:e\s+)?(?:a\s+)?(?:(?:letra|opcao|alternativa|resposta)\s+)?([abcd])$/.exec(t);
  return m ? LETTERS.indexOf(m[1].toUpperCase()) : null;
}

export async function answerGate(id: string, index: number, input: { choice?: number; text?: string }): Promise<GateView> {
  const g = read(id);
  const round = g.rounds[g.rounds.length - 1];
  const q = round.questions[index];
  if (!q || round.answers[index]) throw new Error('pergunta já respondida ou inexistente');
  const choice = input.choice ?? (input.text ? letter(input.text) : null);
  let answer: Answer;
  if (choice !== null && choice >= 0 && choice <= 3) {
    answer = { choice, other: null, correct: choice === q.correct, comment: '' };
  } else {
    const r = await askAgent<{ certa: boolean; comentario: string }>(
      'reply',
      [
        'Avalie uma resposta livre a uma pergunta de quiz de gate. Ela só é certa se chega à mesma conclusão da opção correta, com o mesmo motivo.',
        `Pergunta: ${q.text}`,
        `Opções: ${q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join(' · ')}`,
        `Correta: ${LETTERS[q.correct]}) ${q.options[q.correct]}. Por quê: ${q.explanation}`,
        `Resposta do Luiz (transcrição por voz): «${input.text ?? ''}»`,
        '"comentario": uma frase dizendo o que acertou ou o que faltou, sem revelar a opção certa.',
      ].join('\n'),
      obj({ certa: { type: 'boolean' }, comentario: str }),
      { maxTurns: 2 },
    );
    answer = { choice: null, other: input.text ?? '', correct: r.data.certa, comment: r.data.comentario };
  }
  round.answers[index] = answer;
  return view(write(g));
}

export async function explainGate(id: string, question: string): Promise<GateView> {
  const g = read(id);
  const round = g.rounds[g.rounds.length - 1];
  const missed = round.questions.filter((_, i) => round.answers[i] && !round.answers[i]?.correct);
  const r = await askAgent<{ fala: string }>(
    'deep',
    [
      'Leitura assistida do ciclo de consolidação (agent-pipeline §2.1): leia com o Luiz só a seção onde mora o ponto que escapou, passo a passo, respondendo o que ele perguntar. Não reapresente o artefato inteiro.',
      `Pontos que escaparam: ${missed.map((q) => `«${q.text}» → ${q.section}`).join(' | ') || 'nenhum'}`,
      `Pergunta do Luiz: «${question}»`,
      '"fala": até 90 palavras, para ser ouvida.',
      SPEECH_RULES,
    ].join('\n'),
    obj({ fala: str }),
    { maxTurns: 8, ...(g.sessionId ? { resume: g.sessionId } : {}) },
  );
  g.sessionId = r.sessionId || g.sessionId;
  g.talk.push({ me: true, text: question, at: now() }, { me: false, text: r.data.fala, at: now() });
  return view(write(g));
}

export async function visualGate(id: string): Promise<GateView> {
  const g = read(id);
  const round = g.rounds[g.rounds.length - 1];
  const missed = round.questions.filter((_, i) => !round.answers[i]?.correct);
  if (!missed.length) throw new Error('nenhum ponto errado nesta rodada');
  const r = await askAgent<{ mermaid: string; heading: string; descricao: string }>(
    'deep',
    [
      `Produza o recurso visual do ciclo de consolidação para ${g.artifact}, mirando o ponto que escapou: ${missed.map((q) => `«${q.text}» (certa: ${q.options[q.correct]}; seção ${q.section})`).join(' | ')}.`,
      'Mermaid (flowchart ou sequenceDiagram) por padrão; só o código, sem cercas ```.',
      '"heading": o texto EXATO de um heading do artefato (sem os #), onde o diagrama vai entrar, no fim da seção. "descricao": uma frase dizendo o que o diagrama mostra.',
    ].join('\n'),
    obj({ mermaid: str, heading: str, descricao: str }),
    { maxTurns: 8, ...(g.sessionId ? { resume: g.sessionId } : {}) },
  );
  round.visual = { mermaid: r.data.mermaid.replace(/^```(mermaid)?\s*|```\s*$/g, '').trim(), heading: r.data.heading.replace(/^#+\s*/, '').trim(), description: r.data.descricao, inserted: false };
  return view(write(g));
}

export function insertGateVisual(id: string): GateView {
  const g = read(id);
  const round = g.rounds[g.rounds.length - 1];
  const v = round.visual;
  if (!v || v.inserted) throw new Error('não há recurso visual a inserir');
  if (!g.artifact.startsWith(SPECS)) throw new Error('artefato fora do .specs');
  const lines = readFileSync(g.artifact, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && l.replace(/^#+\s*/, '').trim() === v.heading);
  if (start < 0) throw new Error(`heading «${v.heading}» não encontrado em ${basename(g.artifact)}`);
  const level = (/^#+/.exec(lines[start]) as RegExpExecArray)[0].length;
  let end = lines.findIndex((l, i) => i > start && /^#{1,6} /.test(l) && (/^#+/.exec(l) as RegExpExecArray)[0].length <= level);
  if (end < 0) end = lines.length;
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, '', `<!-- recurso visual do quiz de gate (${new Date().toLocaleDateString('sv-SE')}): ${v.description} -->`, '```mermaid', v.mermaid, '```');
  writeFileSync(g.artifact, lines.join('\n'));
  v.inserted = true;
  return view(write(g));
}

export async function newGateRound(id: string): Promise<GateView> {
  const g = read(id);
  const last = g.rounds[g.rounds.length - 1];
  const missed = last.questions.filter((_, i) => !last.answers[i]?.correct);
  const asked = g.rounds.flatMap((r) => r.questions.map((q) => q.text));
  const r = await askAgent<{ perguntas: RawQuestion[] }>(
    'deep',
    [
      `Nova rodada do quiz do Gate ${g.gate} de ${g.ref} sobre o mesmo ponto que escapou, com perguntas NOVAS (não as mesmas reembaralhadas), mais o que ficou pendente.`,
      `Pontos: ${missed.map((q) => `«${q.text}» (${q.section})`).join(' | ')}`,
      `Já perguntado: ${asked.map((t) => `«${t}»`).join(' ')}`,
      `Releia ${g.artifact}: a seção pode ter mudado.`,
      QUIZ_RULES,
    ].join('\n'),
    obj({ perguntas: { type: 'array', items: QUESTION, minItems: 1, maxItems: 3 } }),
    { maxTurns: 10, ...(g.sessionId ? { resume: g.sessionId } : {}) },
  );
  g.rounds.push({ questions: r.data.perguntas.map((q) => toQuestion(q)), answers: r.data.perguntas.map(() => null), visual: null });
  return view(write(g));
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function recordGate(id: string): GateView {
  const g = read(id);
  if (!g.quizFile.startsWith(SPECS)) throw new Error('GATE_QUIZ fora do .specs');
  const v = view(g);
  const verdicts = v.rounds.map((r) => r.verdict);
  const final = verdicts[verdicts.length - 1];
  const lines = [
    '',
    `## Gate ${g.gate} — ${g.label} (${new Date().toLocaleDateString('sv-SE')})`,
    '',
    `**Veredito:** ${final ?? 'em andamento'} — ${g.rounds.length} rodada(s)${final === 'assertivo' ? ' até fechar' : ' até aqui'} · conduzido por voz no app de cerimônias`,
  ];
  g.rounds.forEach((r, ri) => {
    lines.push('', `### Rodada ${ri + 1}`, '', '| # | Pergunta (tipo) | Opções | Escolhida | Certa? |', '|---|---|---|---|---|');
    r.questions.forEach((q, qi) => {
      const a = r.answers[qi];
      const chosen = !a ? '—' : a.choice !== null ? LETTERS[a.choice] : `Other: "${cell(a.other ?? '')}"`;
      lines.push(`| ${qi + 1} | ${cell(q.text)} (${q.kind}) | ${q.options.map((o, i) => `${LETTERS[i]}) ${cell(o)}`).join(' · ')} | ${chosen} | ${!a ? '—' : a.correct ? 'sim' : '**não**'} |`);
    });
    const missed = r.questions.filter((_, qi) => r.answers[qi] && !r.answers[qi]?.correct);
    if (missed.length) {
      lines.push('', `**Lacuna e como foi fechada:** ${missed.map((q) => `«${q.text}» — a resposta mora em ${q.section}`).join('; ')}.${g.talk.length ? ' Leitura assistida por voz.' : ''}`);
    }
    lines.push('', `**Recurso visual produzido:** ${r.visual ? `mermaid — ${r.visual.description}${r.visual.inserted ? ` (inserido em ${basename(g.artifact)} › ${r.visual.heading})` : ' (não inserido)'}` : '—'}`);
  });
  lines.push('');
  if (!existsSync(g.quizFile)) {
    writeFileSync(
      g.quizFile,
      `# Gate quiz — #${g.iid} ${g.title}\n\n<!-- Registro do quiz de gate. Mecânica em @skills/agent-pipeline/SKILL.md §2.1. -->\n`,
    );
  }
  writeFileSync(g.quizFile, `${readFileSync(g.quizFile, 'utf8').replace(/\n*$/, '\n')}${lines.join('\n')}`);
  g.recorded = new Date().toISOString();
  return view(write(g));
}
