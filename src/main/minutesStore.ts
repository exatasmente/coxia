import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DayIndex,
  type DayUnanswered,
  type DayUnansweredEntry,
  type DayView,
  type DeletePreview,
  type Kept,
  type MinutesVersion,
  type RepeatedQuestion,
  type TrashEntry,
  type VersionView,
  TRASH_DAYS,
  dayFile,
  dayKey,
  diffVersions,
  indexFile,
  mergeDay,
  previousOf,
  repeatedUnanswered,
  snapshotOf,
  versionFile,
} from '../shared/minutesVersions';
import type { Card, Minutes, SavedCeremony, WrittenDecision } from '../shared/types';
import { recordWrite } from './auditoria';
import { voiceText } from '../shared/cycles/text';
import { language, text as word } from './cyclePrompts';
import { ATAS } from './env';
import { HISTORY, ceremonyIds, dateOfId, isLive, readCeremony, today } from './historyFiles';

// Minutes of the day, by version. Every pre-daily of a day is one version: <date>-pre-daily.v<N>.md holds its minutes, and
// <date>-pre-daily.versions.json is the index (numbers, snapshots for the diff, what was written to specs and notes). <date>-pre-daily.md is
// the generated document with every version, kept so anything that read the old single file still finds the day there.
// Deleting moves files and ceremony records to <workspace>/.trash/atas/<timestamp>/ for TRASH_DAYS days.

export const TRASH_ROOT = join(ATAS, '.trash', 'atas');
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_SECTION = /^## Pré-daily (\d{2}:\d{2}:\d{2}) às (\d{2}:\d{2}:\d{2})\s*$/;

const pathOf = (name: string): string => join(ATAS, name);

function atomicWrite(file: string, content: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(`${file}.tmp`, content);
  renameSync(`${file}.tmp`, file);
}

// ---------------------------------------------------------------- the day index

function readIndex(date: string): DayIndex | null {
  try {
    const raw = JSON.parse(readFileSync(pathOf(indexFile(date)), 'utf8')) as DayIndex;
    return raw.version === 1 && Array.isArray(raw.versions) ? raw : null;
  } catch {
    return null;
  }
}

function writeIndex(index: DayIndex): void {
  if (!index.versions.length) {
    rmSync(pathOf(indexFile(index.date)), { force: true });
    return;
  }
  index.versions.sort((a, b) => a.n - b.n);
  atomicWrite(pathOf(indexFile(index.date)), JSON.stringify(index));
}

interface LegacySection {
  start: string;
  end: string;
  body: string;
}

// The single file every pre-daily of the day was appended to.
function legacySections(file: string): LegacySection[] {
  const sections: LegacySection[] = [];
  let open: LegacySection | null = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const head = LEGACY_SECTION.exec(line);
    if (head) {
      open = { start: head[1], end: head[2], body: `${line}\n` };
      sections.push(open);
    } else if (open) open.body += `${line}\n`;
  }
  return sections.map((s) => ({ ...s, body: s.body.replace(/\n+$/, '\n') }));
}

const clockOf = (ms: number): string => new Date(ms).toLocaleTimeString('pt-BR');

function titled(date: string, n: number, body: string): string {
  return `${word('minutes.file.title', { date, n })}\n\n${body}`;
}

function ceremoniesOf(date: string): SavedCeremony[] {
  return ceremonyIds()
    .filter((id) => dateOfId(id) === date)
    .reverse()
    .flatMap((id) => readCeremony(id) ?? []);
}

/**
 * A day written before versions existed gets its index here: each ceremony that started a call becomes a version, in order, and the sections of
 * the old single file are split into the version files. The old file is kept next to them as <date>-pre-daily.legacy.md.
 */
function migrate(date: string): DayIndex {
  const index: DayIndex = { version: 1, date, versions: [], dayTeams: null };
  const legacy = pathOf(dayFile(date));
  const sections = existsSync(legacy) && !readIndex(date) ? legacySections(legacy) : [];
  const used = new Set<number>();
  type Item = { at: number; state?: SavedCeremony; section?: LegacySection };
  const items: Item[] = [];
  for (const state of ceremoniesOf(date)) {
    if (state.startedAt === null) continue;
    const si = sections.findIndex((s, i) => !used.has(i) && s.start === clockOf(state.startedAt as number));
    if (si >= 0) used.add(si);
    items.push({ at: state.startedAt, state, section: si >= 0 ? sections[si] : undefined });
  }
  sections.forEach((section, i) => {
    if (!used.has(i)) items.push({ at: Date.parse(`${date}T${section.start}`), section });
  });
  items.sort((a, b) => a.at - b.at);
  items.forEach((item, i) => {
    const n = i + 1;
    const state = item.state;
    let file: string | null = null;
    if (item.section) {
      file = versionFile(date, n);
      atomicWrite(pathOf(file), titled(date, n, item.section.body));
    }
    const written: WrittenDecision[] = (state?.saveResult?.written ?? []).map((w) => {
      const d = state?.decisions.find((x) => x.ref === w.ref && x.dest === w.dest);
      return { ...w, text: d?.text, target: d?.target };
    });
    index.versions.push({
      n,
      ceremonyId: state?.id ?? '',
      startedAt: state?.startedAt ?? item.at,
      endedAt: state?.endedAt ?? (item.section ? Date.parse(`${date}T${item.section.end}`) : null),
      savedAt: file ? new Date(state?.endedAt ?? item.at).toISOString() : null,
      file,
      teams: state?.teams ?? null,
      written,
      snapshot: state ? snapshotOf(state) : { decisions: [], effects: [], unanswered: [], covered: [] },
    });
  });
  if (index.versions.length) {
    if (sections.length) renameSync(legacy, pathOf(`${date}-pre-daily.legacy.md`));
    writeIndex(index);
    writeDayFile(index);
  }
  return index;
}

/** The index of the day, made from the old layout when the day predates versions. Not written for a day with nothing in it. */
export function ensureDay(date: string): DayIndex {
  return readIndex(date) ?? migrate(date);
}

function writeDayFile(index: DayIndex): void {
  const file = pathOf(dayFile(index.date));
  const parts = index.versions.flatMap((v) => (v.file && existsSync(pathOf(v.file)) ? [readFileSync(pathOf(v.file), 'utf8').trimEnd()] : []));
  if (!parts.length) {
    rmSync(file, { force: true });
    return;
  }
  // The repetition is a fact of the day: it lands as a day-level block after every version's own part, and the version files stay as they are.
  const repeated = dayRepeats(index);
  const section = repeated.length
    ? `\n\n---\n\n${word('minutes.file.repeated.title')}\n\n${word('minutes.file.repeated.intro')}\n\n${repeated
        .map((r) => word('minutes.file.repeated.item', { ref: r.ref, question: r.question, dates: r.dates.join(', '), days: word(r.count === 1 ? 'minutes.day.repeated.days_one' : 'minutes.day.repeated.days_other', { count: r.count }) }))
        .join('\n')}\n`
    : '';
  atomicWrite(file, `${word('minutes.file.dayTitle', { date: index.date })}\n\n${word('minutes.file.dayNote')}\n\n${parts.join('\n\n---\n\n')}${section}\n`);
}

/** Every date that has minutes: an index, a ceremony that started a call, or the old single file. */
export function minutesDates(): string[] {
  const dates = new Set<string>();
  for (const name of existsSync(ATAS) ? readdirSync(ATAS) : []) {
    const m = /^(\d{4}-\d{2}-\d{2})-pre-daily\.(versions\.json|md)$/.exec(name);
    if (m) dates.add(m[1]);
  }
  return [...dates].sort().reverse();
}

// ---------------------------------------------------------------- registering the ceremonies of the day

// Ceremonies deleted from the history must not come back through a stale save from a window that still holds them.
let trashedCache: Set<string> | null = null;

export function trashedCeremonyIds(): Set<string> {
  if (trashedCache) return trashedCache;
  const ids = new Set<string>();
  for (const dir of existsSync(TRASH_ROOT) ? readdirSync(TRASH_ROOT) : []) {
    const m = readManifest(dir);
    for (const v of m?.versions ?? []) if (v.ceremonyId) ids.add(v.ceremonyId);
    for (const id of m?.ceremonyIds ?? []) ids.add(id);
  }
  trashedCache = ids;
  return ids;
}

/** Keeps the day index in step with a ceremony that started its call: the first save gives it its version number. */
export function registerCeremony(state: SavedCeremony): MinutesVersion | null {
  if (state.startedAt === null || trashedCeremonyIds().has(state.id)) return null;
  const date = dateOfId(state.id);
  const index = ensureDay(date);
  const snapshot = snapshotOf(state);
  let rec = index.versions.find((v) => v.ceremonyId === state.id);
  if (!rec) {
    rec = { n: Math.max(0, ...index.versions.map((v) => v.n)) + 1, ceremonyId: state.id, startedAt: state.startedAt, endedAt: state.endedAt, savedAt: null, file: null, teams: state.teams, written: [], snapshot };
    index.versions.push(rec);
    writeIndex(index);
    return rec;
  }
  const next = { ...rec, startedAt: state.startedAt, endedAt: state.endedAt, teams: state.teams ?? rec.teams, snapshot };
  if (JSON.stringify(next) !== JSON.stringify(rec)) {
    index.versions[index.versions.indexOf(rec)] = next;
    writeIndex(index);
    return next;
  }
  return rec;
}

export function versionOfCeremony(id: string): number | null {
  return ensureDay(dateOfId(id)).versions.find((v) => v.ceremonyId === id)?.n ?? null;
}

// ---------------------------------------------------------------- saving the minutes of a version

export interface OpenedVersion {
  n: number;
  path: string;
  // The versions before this one, with what they wrote: a decision they wrote is not written again.
  earlier: MinutesVersion[];
}

/** Finds (or creates) the version the minutes being saved belong to. Nothing is written to the minutes yet. */
export function openVersion(date: string, ceremonyId: string | undefined, m: Pick<Minutes, 'squad' | 'startedAt' | 'endedAt' | 'decisions' | 'effects' | 'unanswered'>): OpenedVersion {
  const index = ensureDay(date);
  const startedAt = Date.parse(m.startedAt);
  let rec = (ceremonyId ? index.versions.find((v) => v.ceremonyId === ceremonyId) : undefined) ?? index.versions.find((v) => v.startedAt === startedAt);
  if (!rec) {
    rec = { n: Math.max(0, ...index.versions.map((v) => v.n)) + 1, ceremonyId: ceremonyId ?? '', ...(m.squad ? { squad: m.squad } : {}), startedAt, endedAt: Date.parse(m.endedAt), savedAt: null, file: null, teams: null, written: [], snapshot: { decisions: m.decisions, effects: m.effects, unanswered: m.unanswered.map((u) => ({ ref: u.ref, question: u.question, stage: null })), covered: [] } };
    index.versions.push(rec);
    writeIndex(index);
  }
  return { n: rec.n, path: pathOf(versionFile(date, rec.n)), earlier: index.versions.filter((v) => v.n < (rec as MinutesVersion).n) };
}

export function writeVersionFile(date: string, n: number, body: string): string {
  const path = pathOf(versionFile(date, n));
  atomicWrite(path, titled(date, n, body));
  return path;
}

/** Records what saving the minutes of a version did, and rebuilds the document of the day. */
export function commitVersion(date: string, n: number, change: { teams: string; written: WrittenDecision[]; snapshot?: MinutesVersion['snapshot'] }): void {
  const index = ensureDay(date);
  const rec = index.versions.find((v) => v.n === n);
  if (!rec) return;
  rec.file = versionFile(date, n);
  rec.savedAt = new Date().toISOString();
  rec.teams = change.teams || rec.teams;
  rec.written = change.written;
  if (change.snapshot) rec.snapshot = change.snapshot;
  writeIndex(index);
  writeDayFile(index);
}

export function selfWritesOf(date: string): NonNullable<DayIndex['selfWrites']> {
  return readIndex(date)?.selfWrites ?? { files: {}, notes: {} };
}

export function recordSelfWrite(date: string, write: { file?: string; note?: { ref: string; text: string } }): void {
  const index = readIndex(date);
  if (!index) return;
  const own = (index.selfWrites ??= { files: {}, notes: {} });
  if (write.file) own.files[write.file] = Math.floor(statSync(write.file).mtimeMs);
  if (write.note) own.notes[write.note.ref] = write.note.text;
  writeIndex(index);
}

export function saveVersionTeams(date: string, n: number, text: string): void {
  const index = readIndex(date);
  const rec = index?.versions.find((v) => v.n === n);
  if (!index || !rec) return;
  rec.teams = text;
  writeIndex(index);
}

export function saveDayTeams(date: string, key: string, text: string): void {
  const index = readIndex(date);
  if (!index) return;
  index.dayTeams = { key, text, at: new Date().toISOString() };
  writeIndex(index);
}

// ---------------------------------------------------------------- reading

/**
 * The unanswered questions of the days before `date`, most recent first, up to `limit`; only days with an index (the read never creates one, so an
 * empty day is skipped, not kept). A malformed index makes the day nothing: the repetition is computed from what can be read.
 */
export function previousDayAnswers(date: string, limit = 7): DayUnanswered[] {
  const out: DayUnanswered[] = [];
  for (const day of minutesDates().filter((d) => d < date)) {
    const index = readIndex(day);
    if (!index) continue;
    const merged = mergeDay(index.versions);
    out.push({ date: day, unanswered: merged.unanswered.map(({ version, ...u }) => ({ ...u, ...(index.versions.find((v) => v.n === version)?.squad ? { squad: index.versions.find((v) => v.n === version)?.squad } : {}) })) });
    if (out.length >= limit) break;
  }
  return out;
}

/** The merged unanswered of the day's own index, each entry tagged with the squad of the version that asked it. */
function dayEntries(index: DayIndex): DayUnansweredEntry[] {
  const merged = mergeDay(index.versions);
  return merged.unanswered.map(({ version, ...u }) => {
    const squad = index.versions.find((v) => v.n === version)?.squad;
    return { ...u, ...(squad ? { squad } : {}) };
  });
}

/** What the day's minutes repeat from the previous days (the pure rule of the snapshot, with the days the folder holds). */
function dayRepeats(index: DayIndex): RepeatedQuestion[] {
  return repeatedUnanswered(index.date, dayEntries(index), previousDayAnswers(index.date));
}

/** The dates the card's question-forma was left unanswered on, before today; empty when it is not one of them. */
export function crossDayRepeats(card: Card, date = today()): string[] {
  return previousDayAnswers(date)
    .filter((d) => d.unanswered.some((u) => u.ref === card.ref && (u.stage === card.stage || u.stage === null || card.stage === null)))
    .map((d) => d.date)
    .sort();
}

export function dayView(date: string): DayView {
  const index = ensureDay(date);
  const versions: VersionView[] = index.versions.map((v) => ({
    ...v,
    live: isLive(v.ceremonyId ? readCeremony(v.ceremonyId) : null),
    diff: diffVersions(previousOf(index.versions, v.n), v.snapshot),
    path: v.file ? pathOf(v.file) : null,
  }));
  const merged = mergeDay(index.versions);
  const dayPath = existsSync(pathOf(dayFile(date))) ? pathOf(dayFile(date)) : null;
  return { date, versions, merged, dayTeams: index.dayTeams, dayKey: dayKey(merged), repeated: dayRepeats(index), dayPath };
}

// ---------------------------------------------------------------- deleting

interface Manifest {
  version: 1;
  trashedAt: string;
  date: string;
  scope: 'versions' | 'day';
  versions: MinutesVersion[];
  ceremonyIds: string[];
  // Files moved (names relative to the workspace folder), in the same layout inside the trash folder.
  files: string[];
  dayTeams: DayIndex['dayTeams'];
}

function readManifest(dir: string): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(join(TRASH_ROOT, dir, 'manifest.json'), 'utf8')) as Manifest;
    return m.version === 1 ? m : null;
  } catch {
    return null;
  }
}

const keptOf = (versions: MinutesVersion[]): DeletePreview['kept'] => {
  const kept: DeletePreview['kept'] = { registro: [], notes: [], effects: [] };
  for (const v of versions) {
    for (const w of v.written) {
      if (!w.ok || w.duplicateOf !== undefined) continue;
      const item: Kept = { n: v.n, ref: w.ref, text: w.text ?? '', dest: w.dest };
      if (w.target === 'spec') kept.registro.push(item);
      else if (w.target === 'note') kept.notes.push(item);
    }
    for (const e of v.snapshot.effects) kept.effects.push({ n: v.n, ref: e.ref, text: e.text, dest: e.repo });
  }
  return kept;
};

function selection(date: string, which: number[] | 'all'): { index: DayIndex; chosen: MinutesVersion[]; drafts: string[] } {
  const index = ensureDay(date);
  const chosen = which === 'all' ? index.versions : index.versions.filter((v) => which.includes(v.n));
  const registered = new Set(index.versions.map((v) => v.ceremonyId));
  // A day deleted whole also takes the ceremonies that never started a call (they have no version).
  const drafts = which === 'all' ? ceremoniesOf(date).filter((s) => !registered.has(s.id)).map((s) => s.id) : [];
  return { index, chosen, drafts };
}

export function previewDelete(date: string, which: number[] | 'all'): DeletePreview {
  if (!DATE.test(date)) throw new Error(word('minutes.delete.badDate'));
  const { chosen, drafts } = selection(date, which);
  const ceremonyIds = [...chosen.map((v) => v.ceremonyId).filter(Boolean), ...drafts];
  const live = ceremonyIds.find((id) => isLive(readCeremony(id)));
  const files = chosen.flatMap((v) => (v.file && existsSync(pathOf(v.file)) ? [v.file] : []));
  if (which === 'all') {
    for (const name of [dayFile(date), indexFile(date), `${date}-pre-daily.legacy.md`]) if (existsSync(pathOf(name))) files.push(name);
  }
  return {
    date,
    scope: which === 'all' ? 'day' : 'versions',
    versions: chosen.map((v) => ({ n: v.n, startedAt: v.startedAt, endedAt: v.endedAt, file: v.file })),
    files,
    ceremonies: ceremonyIds.filter((id) => existsSync(join(HISTORY, `${id}.json`))).length,
    blocked: !chosen.length && !drafts.length ? word('minutes.delete.nothing') : live ? voiceText('minutes.delete.live', language()) : null,
    kept: keptOf(chosen),
    trashDays: TRASH_DAYS,
  };
}

function move(from: string, to: string): void {
  mkdirSync(join(to, '..'), { recursive: true });
  renameSync(from, to);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function deleteMinutes(date: string, which: number[] | 'all', now = new Date()): TrashEntry {
  const preview = previewDelete(date, which);
  if (preview.blocked) throw new Error(preview.blocked);
  const { index, chosen, drafts } = selection(date, which);
  const id = stamp(now);
  const dir = join(TRASH_ROOT, id);
  const ceremonyIds = [...chosen.map((v) => v.ceremonyId).filter(Boolean), ...drafts];
  const moved: string[] = [];
  const take = (name: string) => {
    if (!existsSync(pathOf(name))) return;
    move(pathOf(name), join(dir, name));
    moved.push(name);
  };
  mkdirSync(dir, { recursive: true });
  // The manifest goes first: whatever happens after, the trash folder says what it holds and where it came from.
  const manifest: Manifest = { version: 1, trashedAt: now.toISOString(), date, scope: preview.scope, versions: chosen, ceremonyIds, files: [], dayTeams: index.dayTeams };
  atomicWrite(join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const v of chosen) if (v.file) take(v.file);
  for (const cid of ceremonyIds) take(join('historico', `${cid}.json`));
  if (which === 'all') {
    for (const name of [dayFile(date), indexFile(date), `${date}-pre-daily.legacy.md`]) take(name);
  } else {
    index.versions = index.versions.filter((v) => !chosen.includes(v));
    writeIndex(index);
    writeDayFile(index);
  }
  atomicWrite(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, files: moved }));
  trashedCache = null;
  audit('ata-delete', date, chosen.map((v) => v.n), id, preview);
  return trashEntry(id, manifest, moved, now.getTime());
}

function audit(kind: 'ata-delete' | 'ata-restore', date: string, versions: number[], trashId: string, detail: { scope?: string; files?: string[]; ceremonies?: number }): void {
  recordWrite({
    kind: 'minutes',
    issue: 0,
    target: `atas ${date}`,
    via: 'local',
    fields: { versions: versions.join(',') || 'dia inteiro', lixeira: trashId, escopo: detail.scope ?? '', arquivos: (detail.files ?? []).join(', '), cerimonias: String(detail.ceremonies ?? 0) },
    ok: true,
    code: null,
    result: kind === 'ata-delete' ? word('minutes.audit.deleted') : word('minutes.audit.restored'),
    origin: { actionId: '', kind, key: trashId, summary: `${date}${versions.length ? ` v${versions.join(',v')}` : ''}` },
  });
}

// ---------------------------------------------------------------- the trash

function trashEntry(id: string, m: Manifest, files: string[], now: number): TrashEntry {
  const age = Math.floor((now - Date.parse(m.trashedAt)) / DAY_MS);
  return { id, trashedAt: m.trashedAt, date: m.date, scope: m.scope, versions: m.versions.map((v) => v.n), ceremonies: m.ceremonyIds.length, ceremonyIds: m.ceremonyIds, files, daysLeft: Math.max(0, TRASH_DAYS - age) };
}

export function listTrash(now = Date.now()): TrashEntry[] {
  const out: TrashEntry[] = [];
  for (const dir of existsSync(TRASH_ROOT) ? readdirSync(TRASH_ROOT) : []) {
    const m = readManifest(dir);
    if (!m) continue;
    const entry = trashEntry(dir, m, m.files, now);
    if (now - Date.parse(m.trashedAt) <= TRASH_DAYS * DAY_MS) out.push(entry);
  }
  return out.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

export interface Restored {
  date: string;
  versions: { from: number; to: number }[];
}

export function restoreMinutes(id: string, now = Date.now()): Restored {
  if (!/^[\w-]+$/.test(id)) throw new Error(word('minutes.restore.missing'));
  const dir = join(TRASH_ROOT, id);
  const m = readManifest(id);
  if (!m) throw new Error(word('minutes.restore.missing'));
  if (now - Date.parse(m.trashedAt) > TRASH_DAYS * DAY_MS) throw new Error(word('minutes.restore.expired', { days: TRASH_DAYS }));
  // A ceremony file that is back already means the id is taken: nothing is restored over it.
  for (const cid of m.ceremonyIds) if (existsSync(join(HISTORY, `${cid}.json`))) throw new Error(word('minutes.restore.exists', { id: cid }));
  const index = readIndex(m.date) ?? { version: 1 as const, date: m.date, versions: [], dayTeams: null };
  const taken = new Set(index.versions.map((v) => v.n));
  const renumbered: Restored['versions'] = [];
  // When any number is taken they all go after the existing ones, in their own order, so the day still reads in sequence.
  const shift = m.versions.some((v) => taken.has(v.n));
  const firstFree = Math.max(0, ...taken) + 1;
  for (const [i, v] of m.versions.entries()) {
    const n = shift ? firstFree + i : v.n;
    taken.add(n);
    renumbered.push({ from: v.n, to: n });
    const rec = { ...v, n, file: v.file && n !== v.n ? versionFile(m.date, n) : v.file };
    if (v.file && existsSync(join(dir, v.file))) {
      if (existsSync(pathOf(rec.file as string))) throw new Error(word('minutes.restore.exists', { id: rec.file as string }));
      move(join(dir, v.file), pathOf(rec.file as string));
    }
    index.versions.push(rec);
  }
  for (const name of m.files) {
    if (!existsSync(join(dir, name)) || /^\d{4}-\d{2}-\d{2}-pre-daily\.v\d+\.md$/.test(name)) continue;
    // The generated document and the index are rebuilt from the versions; the old single file comes back as it was.
    if (name === dayFile(m.date) || name === indexFile(m.date) || existsSync(pathOf(name))) continue;
    move(join(dir, name), pathOf(name));
  }
  index.dayTeams ??= m.dayTeams;
  writeIndex(index);
  writeDayFile(index);
  rmSync(dir, { recursive: true, force: true });
  trashedCache = null;
  audit('ata-restore', m.date, renumbered.map((r) => r.to), id, { scope: m.scope, files: m.files, ceremonies: m.ceremonyIds.length });
  return { date: m.date, versions: renumbered };
}

/** Removes what stayed in the trash past its time. Run by the retention job. */
export function purgeTrash(now = Date.now()): number {
  let purged = 0;
  for (const dir of existsSync(TRASH_ROOT) ? readdirSync(TRASH_ROOT) : []) {
    const m = readManifest(dir);
    const at = m ? Date.parse(m.trashedAt) : statSync(join(TRASH_ROOT, dir)).mtimeMs;
    if (now - at <= TRASH_DAYS * DAY_MS) continue;
    rmSync(join(TRASH_ROOT, dir), { recursive: true, force: true });
    purged += 1;
  }
  if (purged) trashedCache = null;
  return purged;
}
