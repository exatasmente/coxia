import { t } from '../shared/i18n';
// Per-sentence prosody: the free Edge endpoint takes one rate and one pitch per request, so each sentence is its own
// request with its own deltas, and the pauses between them are inserted as silence when the audio is joined.

export type Tone = 'neutral' | 'question' | 'exclaim' | 'alert' | 'positive' | 'aside';

export interface Segment {
  text: string;
  tone: Tone;
  rate: number; // percent added to the voice's rate
  pitch: number; // Hz added to the voice's pitch
  pauseMs: number; // silence after this segment
}

const TONES: Record<Tone, { rate: number; pitch: number }> = {
  neutral: { rate: 0, pitch: 0 },
  question: { rate: -2, pitch: 5 },
  exclaim: { rate: 4, pitch: 4 },
  alert: { rate: -7, pitch: -3 },
  positive: { rate: 3, pitch: 2 },
  aside: { rate: 6, pitch: -3 },
};

const PAUSE = { sentence: 300, question: 450, exclaim: 350, ellipsis: 550, colon: 250, item: 320, paragraph: 600 };
const CLOSING_RATE = -4;
const MAX_SEGMENTS = 40;

// Word lists that decide the tone of a sentence: Portuguese and English together, so the speech follows whatever language the agent answered in.
const ALERT = /\b(bloque\w*|conflit\w*|falh\w*|erros?\b|urgent\w*|aten[çc][ãa]o|cuidado|quebr\w*|travad\w*|atrasad\w*|riscos?\b|reprovad\w*|P[01]\b|vencid\w*|block\w*|conflict\w*|fail\w*|errors?\b|attention|careful|broken|stuck|late|overdue|risks?\b|rejected|expired)/i; // i18n-ignore: tone heuristic
const POSITIVE = /\b(aprovad\w*|pront[oa]s?\b|mergead\w*|passou|passaram|verdes?\b|resolvid\w*|conclu[íi]d\w*|liberad\w*|deu certo|approved|ready|merged|passed|green|resolved|done|released|worked)/i; // i18n-ignore: tone heuristic
// "sem bloqueio", "nenhum conflito", "não há risco", "no blockers": the alert word is negated
const NEGATED = /\b(sem|nenhum|nenhuma|n[ãa]o h[áa]|n[ãa]o tem|no|none|without|there (?:is|are) no|nothing)\s+(\w+\s+)?\w+/gi; // i18n-ignore: tone heuristic
const ABBREVIATIONS = /\b(sr|sra|dr|dra|ex|p\.ex|etc|aprox|obs|vs|n[ºo]|art|cap|pág|pag|mr|mrs|ms|prof|e\.g|i\.e|approx|fig|jr|st)\.$/i; // i18n-ignore: abbreviations that do not end a sentence

export function speakable(text: string): string {
  return text
    .replace(/```mermaid[\s\S]*?```/gi, `\n${t('main.speech.diagram')}\n`)
    .replace(/```[\s\S]*?```/g, `\n${t('main.speech.code')}\n`)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, t('main.speech.link'))
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function toneOf(sentence: string): Tone {
  const s = sentence.trim();
  if (/^\(.*\)[.!?…]*$/.test(s)) return 'aside';
  if (/\?["')\]]*$/.test(s)) return 'question';
  if (ALERT.test(s.replace(NEGATED, ''))) return 'alert';
  if (/!["')\]]*$/.test(s)) return 'exclaim';
  if (POSITIVE.test(s)) return 'positive';
  return 'neutral';
}

function pauseAfter(sentence: string): number {
  const s = sentence.trim().replace(/["')\]]+$/, '');
  if (/(\.\.\.|…)$/.test(s)) return PAUSE.ellipsis;
  if (s.endsWith('?')) return PAUSE.question;
  if (s.endsWith('!')) return PAUSE.exclaim;
  if (s.endsWith(':')) return PAUSE.colon;
  return PAUSE.sentence;
}

export function sentences(paragraph: string): string[] {
  const out: string[] = [];
  let start = 0;
  const boundary = /([.!?…]+|:)["')\]]*\s+(?=["'(\[]?[A-ZÀ-Ý0-9#])/g;
  for (const m of paragraph.matchAll(boundary)) {
    const end = m.index + m[0].length;
    const piece = paragraph.slice(start, end).trim();
    // "Sr. Silva", "ex. 2": not the end of a sentence
    if (m[1] === '.' && ABBREVIATIONS.test(piece)) continue;
    // "Passo 1: faça X" keeps the colon inside the sentence unless a list follows
    if (m[1] === ':') continue;
    out.push(piece);
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function prosodyPlan(text: string): Segment[] {
  const clean = speakable(text);
  const segments: Segment[] = [];
  for (const block of clean.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    // consecutive non-item lines are one paragraph; each list item is its own unit
    const units: { text: string; item: boolean }[] = [];
    for (const line of lines) {
      const item = ITEM.test(line);
      const body = line.replace(ITEM, '');
      const prev = units[units.length - 1];
      if (!item && prev && !prev.item) prev.text += ` ${body}`;
      else units.push({ text: body, item });
    }
    for (const unit of units) {
      for (const s of sentences(unit.text)) {
        const tone = toneOf(s);
        segments.push({ text: s, tone, ...TONES[tone], pauseMs: pauseAfter(s) });
      }
      const last = segments[segments.length - 1];
      if (unit.item && last) last.pauseMs = Math.max(last.pauseMs, PAUSE.item);
    }
    const last = segments[segments.length - 1];
    if (last) last.pauseMs = Math.max(last.pauseMs, PAUSE.paragraph);
  }
  if (segments.length === 0) return [];
  // slowing down on the last sentence closes the speech
  const final = segments[segments.length - 1];
  if (segments.length >= 3 && final.tone !== 'question') final.rate += CLOSING_RATE;
  final.pauseMs = 0;
  if (segments.length > MAX_SEGMENTS) {
    const tail = segments.splice(MAX_SEGMENTS - 1);
    segments.push({ text: tail.map((s) => s.text).join(' '), tone: 'neutral', rate: 0, pitch: 0, pauseMs: 0 });
  }
  return segments;
}

function parseSigned(value: string, unit: string): number {
  const n = Number.parseFloat(value.replace(unit, ''));
  return Number.isFinite(n) ? n : 0;
}

function signed(n: number, unit: string): string {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : ''}${r}${unit}`;
}

export function edgeRate(base: string, delta: number): string {
  return signed(Math.max(-50, Math.min(100, parseSigned(base, '%') + delta)), '%');
}

export function edgePitch(base: string, delta: number): string {
  return signed(Math.max(-50, Math.min(50, parseSigned(base, 'Hz') + delta)), 'Hz');
}

export function kokoroSpeed(base: number, delta: number): number {
  return Math.round(Math.max(0.5, Math.min(2, base * (1 + delta / 100))) * 1000) / 1000;
}

// A single neutral sentence gains nothing from the joined path: it keeps the plain request.
export function needsJoin(plan: Segment[]): boolean {
  return plan.length > 1 || plan.some((s) => s.rate !== 0 || s.pitch !== 0);
}
