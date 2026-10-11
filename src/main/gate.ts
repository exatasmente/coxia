import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Card, GateOption, GateRoundView, GateView, Talk } from '../shared/types';
import type { PluginDocumentType } from '../shared/plugins/declaration';
import { askAgent, obj, str } from './agents';
import { answerCeremonyMentions } from './mentions/ceremony';
import { cycle, formatTime, language, prompt as cp, text as cycleWord } from './cyclePrompts';
import { ATAS } from './env';
import { rc } from './workspaceConfig';
import { assertExternalWrite } from './workspace';
import { t } from '../shared/i18n';

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
  talk: Talk[];
  recorded: string | null;
  createdAt: string;
}

const DIR = join(ATAS, 'gates');
const ID = /^[\w-]+$/;
export const LETTERS = ['A', 'B', 'C', 'D'];

function inSpecs(file: string): boolean {
  const specs = rc().specsDir;
  return !!specs && file.startsWith(specs);
}

function now(): string {
  return formatTime(new Date());
}

function read(id: string): Gate {
  if (!ID.test(id)) throw new Error(t('main.gate.invalid'));
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
        // i18n-ignore: the verdict is a code the screens compare, not text
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

/**
 * The document types the plugins that are on add to the cycle folder: what they offer, `flow` included. Set once by the plugins module; empty when none is
 * registered, so a workspace with no plugins behaves exactly as before.
 */
export const gatePluginDocuments: { files: () => PluginDocumentType[] } = {
  files: () => [],
};

export function gateOptions(card: Card): GateOption[] {
  if (!card.spec) return [];
  const folder = card.spec.folder;
  const fromCycle = rc().specLayout.gateFiles.flatMap((c) => {
    const hit = c.files.find(([f]) => existsSync(join(folder, c.sub, f)));
    return hit ? [{ gate: c.gate, label: cycleWord(hit[1]), file: join(folder, c.sub, hit[0]) }] : [];
  });
  // The document types the plugins that are on add: a second source summed to the cycle's own, never a change to the reader of today's types. A
  // plugin's document lands where the run writes its documents: the folder's root, or a subfolder the layout names; both are looked at, in that order.
  // A document that says which gate reads it is offered there; one that says none is not a gate's artifact, and one that says nothing (a stage's
  // by-product) stays at gate 2, where every plugin document landed before.
  const subs = ['', ...new Set(rc().specLayout.gateFiles.map((c) => c.sub).filter(Boolean))];
  const fromPlugins = gatePluginDocuments.files().flatMap((d) => {
    const gate = d.flow ? d.flow.gate : 2;
    if (!gate) return [];
    const at = subs.map((sub) => join(folder, sub, d.name)).find((p) => existsSync(p));
    return at ? [{ gate, label: cycleWord(d.label), file: at }] : [];
  });
  return [...fromCycle, ...fromPlugins];
}

/**
 * The artifact a gate opens with: the option the screen's button named, when it is one of this card's options for that gate; else the first option of the
 * gate (what every call that names no file already gets). A file outside the card's options is never opened by parameter.
 */
export function pickGateOption(options: GateOption[], gate: 1 | 2, file?: string): GateOption | undefined {
  const ofGate = options.filter((o) => o.gate === gate);
  return ofGate.find((o) => o.file === file) ?? ofGate[0];
}

// The quiz as the cycle defines it: how many questions a round has and the kinds of consequence question it may use.
function gateParams() {
  const p = cycle().ceremonyParams.gate;
  return { max: p.maxQuestions, kinds: p.questionKinds.map((k) => cycleWord(k)), words: p.summaryWords };
}

function questionSchema(kinds: string[]) {
  return obj({
    pergunta: str,
    tipo: { enum: kinds },
    opcoes: { type: 'array', items: str, minItems: 4, maxItems: 4 },
    correta: { type: 'integer', minimum: 0, maximum: 3 },
    secao: str,
    explicacao: str,
  });
}

function quizSchema(extra: Record<string, unknown>) {
  const { max, kinds } = gateParams();
  return obj({ ...extra, perguntas: { type: 'array', items: questionSchema(kinds), minItems: 1, maxItems: max } });
}

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
    explanation: q.explicacao.replace(/\b(?:op[cç][aã]o|letra|alternativa|option|letter|choice)\s+[A-D]\b/gi, cp('gate.correctOption')),
  };
}

function quizRules(): string {
  const { max, kinds } = gateParams();
  return cp('gate.rules', { rulesRef: cp('gate.rulesRef'), max, kinds: kinds.join(', ') });
}

export async function startGate(card: Card, gate: 1 | 2, file?: string): Promise<GateView> {
  const option = pickGateOption(gateOptions(card), gate, file);
  if (!option) throw new Error(t('main.gate.noArtifact', { iid: card.iid, gate }));
  const { words } = gateParams();
  const prompt = cp('gate.start', { gate, ref: card.ref, title: card.title, file: option.file, words, quizRules: quizRules() });
  const r = await askAgent<{ resumo: string; perguntas: RawQuestion[] }>('deep', prompt, quizSchema({ resumo: str }), { maxTurns: 16 });
  const g: Gate = {
    id: `${card.iid}-gate${gate}-${Date.now().toString(36)}`,
    ref: card.ref,
    iid: card.iid,
    title: card.title,
    gate,
    label: option.label,
    artifact: option.file,
    quizFile: join(dirname(option.file), rc().specLayout.documents.gateQuiz),
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
  if (!q || round.answers[index]) throw new Error(t('main.gate.answered'));
  const choice = input.choice ?? (input.text ? letter(input.text) : null);
  let answer: Answer;
  if (choice !== null && choice >= 0 && choice <= 3) {
    answer = { choice, other: null, correct: choice === q.correct, comment: '' };
  } else {
    // A free answer may name an agent of the team: it answers inside the ceremony, before the reply agent reads the answer.
    const mentioned = await answerCeremonyMentions(input.text ?? '', { thread: g.id, ref: g.ref, title: g.title, msgs: g.talk.map((m) => ({ who: m.me ? 'me' : (m.agent ?? 'app'), text: m.text })) });
    if (mentioned.length) g.talk.push(...mentioned.map((m) => ({ me: false, agent: m.agent, text: m.text, speech: m.speech, at: now() })));
    const r = await askAgent<{ certa: boolean; comentario: string }>(
      'reply',
      cp('gate.answer', {
        question: q.text,
        options: q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join(' · '),
        correct: `${LETTERS[q.correct]}) ${q.options[q.correct]}`,
        why: q.explanation,
        text: input.text ?? '',
      }),
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
  const mentioned = await answerCeremonyMentions(question, { thread: g.id, ref: g.ref, title: g.title, msgs: g.talk.map((m) => ({ who: m.me ? 'me' : (m.agent ?? 'app'), text: m.text })) });
  const round = g.rounds[g.rounds.length - 1];
  const missed = round.questions.filter((_, i) => round.answers[i] && !round.answers[i]?.correct);
  const r = await askAgent<{ fala: string; texto: string }>(
    'deep',
    cp('gate.explain', {
      rulesRef: cp('gate.rulesRef'),
      missed: missed.map((q) => `«${q.text}» → ${q.section}`).join(' | ') || cp('gate.explainNone'),
      question,
    }),
    obj({ fala: str, texto: str }),
    { maxTurns: 8, ...(g.sessionId ? { resume: g.sessionId } : {}) },
  );
  g.sessionId = r.sessionId || g.sessionId;
  // The person's question, then each agent it named, then the system agent, which keeps leading the ceremony.
  g.talk.push(
    { me: true, text: question, at: now() },
    ...mentioned.map((m) => ({ me: false, agent: m.agent, text: m.text, speech: m.speech, at: now() })),
    { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now(), ...(r.partial ? { partial: true } : {}) },
  );
  return view(write(g));
}

export async function visualGate(id: string): Promise<GateView> {
  const g = read(id);
  const round = g.rounds[g.rounds.length - 1];
  const missed = round.questions.filter((_, i) => !round.answers[i]?.correct);
  if (!missed.length) throw new Error(t('main.gate.nothingMissed'));
  const points = missed.map((q) => cp('gate.visualPoint', { text: q.text, correct: q.options[q.correct], section: q.section })).join(' | ');
  const r = await askAgent<{ mermaid: string; heading: string; descricao: string }>(
    'deep',
    cp('gate.visual', { artifact: g.artifact, missed: points }),
    obj({ mermaid: str, heading: str, descricao: str }),
    { maxTurns: 8, ...(g.sessionId ? { resume: g.sessionId } : {}) },
  );
  round.visual = { mermaid: r.data.mermaid.replace(/^```(mermaid)?\s*|```\s*$/g, '').trim(), heading: r.data.heading.replace(/^#+\s*/, '').trim(), description: r.data.descricao, inserted: false };
  return view(write(g));
}

export function insertGateVisual(id: string): GateView {
  assertExternalWrite(t('main.gate.whatInsert'));
  const g = read(id);
  const round = g.rounds[g.rounds.length - 1];
  const v = round.visual;
  if (!v || v.inserted) throw new Error(t('main.gate.noVisual'));
  if (!inSpecs(g.artifact)) throw new Error(t('main.gate.outsideSpecs'));
  const lines = readFileSync(g.artifact, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && l.replace(/^#+\s*/, '').trim() === v.heading);
  if (start < 0) throw new Error(t('main.gate.noHeading', { heading: v.heading, file: basename(g.artifact) }));
  const level = (/^#+/.exec(lines[start]) as RegExpExecArray)[0].length;
  let end = lines.findIndex((l, i) => i > start && /^#{1,6} /.test(l) && (/^#+/.exec(l) as RegExpExecArray)[0].length <= level);
  if (end < 0) end = lines.length;
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, '', cp('gate.doc.visualComment', { date: new Date().toLocaleDateString('sv-SE'), description: v.description }), '```mermaid', v.mermaid, '```');
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
    cp('gate.round', {
      gate: g.gate,
      ref: g.ref,
      points: missed.map((q) => `«${q.text}» (${q.section})`).join(' | '),
      asked: asked.map((t) => `«${t}»`).join(' '),
      artifact: g.artifact,
      quizRules: quizRules(),
    }),
    quizSchema({}),
    { maxTurns: 10, ...(g.sessionId ? { resume: g.sessionId } : {}) },
  );
  g.rounds.push({ questions: r.data.perguntas.map((q) => toQuestion(q)), answers: r.data.perguntas.map(() => null), visual: null });
  return view(write(g));
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function recordGate(id: string): GateView {
  assertExternalWrite(t('main.gate.whatRecord'));
  const g = read(id);
  if (!inSpecs(g.quizFile)) throw new Error(t('main.gate.quizOutside', { file: rc().specLayout.documents.gateQuiz }));
  const v = view(g);
  const verdicts = v.rounds.map((r) => r.verdict);
  const final = verdicts[verdicts.length - 1];
  const lines = [
    '',
    cp('gate.doc.heading', { gate: g.gate, label: g.label, date: new Date().toLocaleDateString('sv-SE') }),
    '',
    cp('gate.doc.verdict', {
      verdict: final === 'assertivo' ? cp('gate.doc.verdictRight') : final ? cp('gate.doc.verdictWrong') : cp('gate.doc.verdictOpen'),
      rounds: g.rounds.length,
      tail: final === 'assertivo' ? cp('gate.doc.tailDone') : cp('gate.doc.tailOpen'),
    }),
  ];
  g.rounds.forEach((r, ri) => {
    lines.push('', cp('gate.doc.round', { n: ri + 1 }), '', cp('gate.doc.table'));
    r.questions.forEach((q, qi) => {
      const a = r.answers[qi];
      const chosen = !a ? '—' : a.choice !== null ? LETTERS[a.choice] : cp('gate.doc.other', { text: cell(a.other ?? '') });
      lines.push(`| ${qi + 1} | ${cell(q.text)} (${q.kind}) | ${q.options.map((o, i) => `${LETTERS[i]}) ${cell(o)}`).join(' · ')} | ${chosen} | ${!a ? '—' : a.correct ? cp('gate.doc.yes') : cp('gate.doc.no')} |`);
    });
    const missed = r.questions.filter((_, qi) => r.answers[qi] && !r.answers[qi]?.correct);
    if (missed.length) {
      lines.push('', cp('gate.doc.gap', { items: missed.map((q) => cp('gate.doc.gapItem', { text: q.text, section: q.section })).join('; '), voice: g.talk.length ? cp('gate.doc.gapVoice') : '' }));
    }
    const visual = r.visual
      ? r.visual.inserted
        ? cp('gate.doc.visualDone', { description: r.visual.description, file: basename(g.artifact), heading: r.visual.heading })
        : cp('gate.doc.visualPending', { description: r.visual.description })
      : '—';
    lines.push('', cp('gate.doc.visual', { value: visual }));
  });
  lines.push('');
  if (!existsSync(g.quizFile)) {
    writeFileSync(g.quizFile, cp('gate.doc.title', { iid: g.iid, title: g.title, note: cp('gate.doc.note') }));
  }
  writeFileSync(g.quizFile, `${readFileSync(g.quizFile, 'utf8').replace(/\n*$/, '\n')}${lines.join('\n')}`);
  g.recorded = new Date().toISOString();
  return view(write(g));
}
