import type { SavedCeremony } from '../shared/types';
import { TEMPO_LABEL, type TempoBlock, type TempoDay, type TempoEntry, type TempoIssue, type TempoKind } from '../shared/tempo';

const MIN = 60_000;
// A gap longer than this inside a pre-daily item means the call was paused, not that the agent was still talking.
const PAUSE_MS = 10 * MIN;
const TAIL_MS = 60_000;
const PROJECT = 'cerimonias';

export interface Span {
  kind: TempoKind;
  ref: string | null;
  iid: string | null;
  title: string;
  sessionId: string | null;
  from: number;
  to: number;
  note: string;
  gate?: number;
}

export interface GateFile {
  ref: string;
  iid: string;
  title: string;
  gate: number;
  sessionId: string | null;
  createdAt: string;
  recorded: string | null;
}

export interface QaFile {
  ref: string;
  iid: string;
  title: string;
  sessionId: string | null;
  createdAt: string;
}

export interface RetroFile {
  sessionId: string | null;
  createdAt: string;
}

// mtime is the last time the app wrote the file, which is the last time Luiz touched that ceremony.
export interface Timed<T> {
  data: T;
  mtime: number;
}

export function localDate(ms: number): string {
  return new Date(ms).toLocaleDateString('sv-SE');
}

function offset(d: Date): string {
  const m = -d.getTimezoneOffset();
  const abs = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// Same text as Python's isoformat(timespec="minutes"), which is what clockify-log prints and parses.
export function iso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDate(ms)}T${p(d.getHours())}:${p(d.getMinutes())}${offset(d)}`;
}

function clip(text: string, n = 60): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function describe(kind: TempoKind, iid: string | null, title: string, gate?: number): string {
  const label = kind === 'gate' && gate ? `gate ${gate}` : TEMPO_LABEL[kind];
  if (kind === 'daily') return 'Cerimônias - Daily';
  if (kind === 'retro') return 'Cerimônias - Retro semanal';
  return clip(iid ? `#${iid} - ${label}: ${title}` : `Cerimônias - ${label}`);
}

function clock(at: string): number {
  const parts = at.split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60_000 + parts[1] * 1000 : 0;
}

function hhmm(date: string, at: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at);
  return m ? new Date(`${date}T${m[1].padStart(2, '0')}:${m[2]}:00`).getTime() : null;
}

// Pre-daily: log lines carry the activity (#iid) and the time since the call started. An activity lasts from its first line
// to the first line of the next one (the last one, to the end of the call); the opening is the daily itself.
export function ceremonySpans(s: SavedCeremony, fileMtime: number): Span[] {
  if (!s.startedAt) return [];
  const started = s.startedAt;
  const end = s.endedAt ?? Math.max(fileMtime, started);
  const titles = new Map((s.cards?.cards ?? []).map((c) => [c.iid, c]));

  type Run = { iid: string; from: number; last: number };
  const runs: Run[] = [];
  for (const line of s.log) {
    if (!line.who.startsWith('#')) continue;
    const iid = line.who.slice(1);
    const at = started + clock(line.at);
    const run = runs[runs.length - 1];
    if (run?.iid === iid) run.last = at;
    else runs.push({ iid, from: at, last: at });
  }

  const spans: Span[] = [];
  const push = (kind: TempoKind, iid: string | null, from: number, to: number, note: string) => {
    if (to <= from) return;
    const card = iid ? titles.get(iid) : undefined;
    spans.push({ kind, ref: card?.ref ?? (iid ? `sz4#${iid}` : null), iid, title: card?.title ?? '', sessionId: card ? (s.turns[card.ref]?.sessionId ?? null) : null, from, to, note });
  };

  if (!runs.length) {
    push('daily', null, started, end, 'call sem atividades');
    return spans;
  }
  push('daily', null, started, runs[0].from, 'abertura');
  runs.forEach((run, i) => {
    const next = runs[i + 1]?.from ?? end;
    const to = next - run.last > PAUSE_MS ? run.last + TAIL_MS : next;
    push('pre-daily', run.iid, run.from, to, 'call');
  });
  return spans;
}

// Deep dives only have HH:MM stamps; the answer of the agent takes at least a minute after the last one.
export function deepSpans(s: SavedCeremony): Span[] {
  const titles = new Map((s.cards?.cards ?? []).map((c) => [c.ref, c]));
  return Object.entries(s.deep).flatMap(([ref, d]) => {
    const stamps = d.msgs.map((m) => hhmm(s.date, m.at)).filter((t): t is number => t !== null);
    if (!stamps.length) return [];
    const card = titles.get(ref);
    return [{ kind: 'desbloqueio' as const, ref, iid: card?.iid ?? ref.split('#').pop() ?? null, title: card?.title ?? '', sessionId: d.sessionId, from: Math.min(...stamps), to: Math.max(...stamps) + MIN, note: `${d.msgs.length} mensagens` }];
  });
}

export function gateSpan({ data: g, mtime }: Timed<GateFile>): Span {
  const from = new Date(g.createdAt).getTime();
  const to = Math.max(g.recorded ? new Date(g.recorded).getTime() : 0, mtime);
  return { kind: 'gate', ref: g.ref, iid: g.iid, title: g.title, sessionId: g.sessionId, from, to, gate: g.gate, note: g.recorded ? 'registrado' : 'sem registro' };
}

export function qaSpan({ data: q, mtime }: Timed<QaFile>): Span {
  return { kind: 'qa', ref: q.ref, iid: q.iid, title: q.title, sessionId: q.sessionId, from: new Date(q.createdAt).getTime(), to: mtime, note: 'checklist e aviso' };
}

export function retroSpan({ data: r, mtime }: Timed<RetroFile>): Span {
  return { kind: 'retro', ref: null, iid: null, title: '', sessionId: r.sessionId, from: new Date(r.createdAt).getTime(), to: mtime, note: 'retro semanal' };
}

// Specific work wins the clock over the call it happened in; the call keeps the rest.
const PRIORITY: Record<TempoKind, number> = { gate: 0, qa: 0, retro: 0, desbloqueio: 0, 'pre-daily': 1, daily: 2 };

function floorMin(ms: number): number {
  return Math.floor(ms / MIN) * MIN;
}
function ceilMin(ms: number): number {
  return Math.ceil(ms / MIN) * MIN;
}

export function blocksOf(spans: Span[], date: string): TempoBlock[] {
  return spans
    .map((sp) => ({ ...sp, from: floorMin(sp.from), to: Math.max(ceilMin(sp.to), floorMin(sp.from) + MIN) }))
    .filter((sp) => localDate(sp.from) === date)
    .sort((a, b) => a.from - b.from)
    .map((sp): TempoBlock => ({
      start: iso(sp.from),
      end: iso(sp.to),
      minutes: Math.round((sp.to - sp.from) / MIN),
      seconds: Math.round((sp.to - sp.from) / 1000),
      projects: [PROJECT],
      gitlab_ids: { issues: sp.iid ? [`#${sp.iid}`] : [], mrs: [] },
      events: [{ time: new Date(sp.from).toTimeString().slice(0, 5), kind: 'ceremony', project: PROJECT, text: clip(`${TEMPO_LABEL[sp.kind]}: ${sp.title ? `${sp.title} (${sp.note})` : sp.note}`, 120) }],
      ceremony: sp.kind,
      ref: sp.ref,
      sessionId: sp.sessionId,
      description: describe(sp.kind, sp.iid, sp.title, sp.gate),
    }));
}

// Clockify refuses overlapping entries, so the day is cut into pieces that never overlap.
export function entriesOf(blocks: TempoBlock[]): TempoEntry[] {
  const ms = (s: string) => new Date(s).getTime();
  const taken: [number, number][] = [];
  const pieces: { from: number; to: number; block: TempoBlock }[] = [];
  const order = [...blocks].sort((a, b) => PRIORITY[a.ceremony] - PRIORITY[b.ceremony] || ms(a.start) - ms(b.start));
  for (const b of order) {
    let free: [number, number][] = [[ms(b.start), ms(b.end)]];
    for (const [ta, tb] of taken) {
      free = free.flatMap(([fa, fb]): [number, number][] => (tb <= fa || ta >= fb ? [[fa, fb]] : [[fa, Math.max(fa, ta)], [Math.min(fb, tb), fb]]));
    }
    for (const [fa, fb] of free) {
      if (fb - fa >= MIN) {
        pieces.push({ from: fa, to: fb, block: b });
        taken.push([fa, fb]);
      }
    }
  }
  pieces.sort((a, b) => a.from - b.from);
  const out: TempoEntry[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    const entry: TempoEntry = { start: iso(p.from), end: iso(p.to), description: p.block.description, issue: p.block.gitlab_ids.issues[0] ?? null, ceremony: p.block.ceremony };
    if (prev && prev.description === entry.description && prev.end === entry.start) prev.end = entry.end;
    else out.push(entry);
  }
  return out;
}

export function issuesOf(entries: TempoEntry[], titles: Map<string, string>): TempoIssue[] {
  const by = new Map<string, TempoIssue>();
  for (const e of entries) {
    const key = e.issue ?? '';
    const row = by.get(key) ?? { issue: e.issue, title: e.issue ? (titles.get(e.issue) ?? '') : 'Cerimônias sem issue', minutes: 0, byCeremony: {} };
    const m = Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / MIN);
    row.minutes += m;
    row.byCeremony[e.ceremony] = (row.byCeremony[e.ceremony] ?? 0) + m;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.minutes - a.minutes);
}

export function buildDay(date: string, spans: Span[], file: string, now = Date.now()): TempoDay {
  const blocks = blocksOf(spans, date);
  const entries = entriesOf(blocks);
  const titles = new Map<string, string>();
  for (const sp of spans) if (sp.iid && sp.title) titles.set(`#${sp.iid}`, sp.title);
  const issues = issuesOf(entries, titles);
  return { version: 1, source: 'cerimonias', date, generatedAt: new Date(now).toISOString(), blocks, entries, issues, totalMinutes: issues.reduce((n, i) => n + i.minutes, 0), file };
}
