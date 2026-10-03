import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { norm } from '../shared/minutesVersions';
import type { Decision, Minutes, SaveResult, WrittenDecision } from '../shared/types';
import { ATAS } from './env';
import { invalidateReport } from './report';
import { ceremonyLabel, decisionLogHeading, formatClock, prompt as cp, text as cycleWord } from './cyclePrompts';
import { dateOfId } from './historyFiles';
import { commitVersion, openVersion, recordSelfWrite, writeVersionFile } from './minutesStore';
import { externalRefusal } from './workspace';
import { getConfig, rc } from './workspaceConfig';
import { upperFirst } from '../shared/cycles/text';
import { modeText } from './agentVoice';
import { t } from '../shared/i18n';
import { proposeVcsCommands } from './actions';
import { vcsProvider } from './vcs';

const run = promisify(execFile);

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

// Which squad the ceremony was held for, or the whole workspace; a workspace with no squads says nothing, as before.
function scopeLine(m: Minutes): string[] {
  const config = getConfig();
  if (m.squad) {
    const squad = (config.squads ?? []).find((q) => q.id === m.squad);
    return [t('main.ata.squad', { squad: squad ? cycleWord(squad.name || squad.id) : m.squad }), ''];
  }
  return config.squads?.length ? [t('main.ata.wholeWorkspace'), ''] : [];
}

export function minutesMarkdown(m: Minutes, teams: string): string {
  const lines = [
    t('main.ata.heading', { ceremony: upperFirst(ceremonyLabel()), from: formatClock(new Date(m.startedAt)), to: formatClock(new Date(m.endedAt)) }),
    '',
    ...scopeLine(m),
    t('main.ata.decisions'),
    ...(m.decisions.length ? m.decisions.map((d) => `- ${d.ref}: ${d.text} → ${d.dest}`) : [`- ${t('main.ata.none')}`]),
    '',
    t('main.ata.effects'),
    ...(m.effects.length ? m.effects.map((e) => `- ${e.ref} (${e.repo}): ${e.text}`) : [`- ${t('main.ata.noneMasc')}`]),
    '',
    t('main.ata.unanswered'),
    ...(m.unanswered.length ? m.unanswered.map((u) => `- ${u.ref}: ${u.question}`) : [`- ${t('main.ata.none')}`]),
    '',
    t('main.ata.teams'),
    '',
    '```',
    teams,
    '```',
    '',
    t('main.ata.transcript'),
    ...m.transcript.map((t) => `- ${t.at} **${t.who}**: ${t.text}`),
    '',
  ];
  return lines.join('\n');
}

function planPath(dest: string): string | null {
  const path = dest.replace(/ › [^›]*$/, '');
  return path.endsWith('.md') && existsSync(path) ? path : null;
}

interface Written {
  ok: boolean;
  detail: string;
  // The document already had this decision: nothing was written.
  duplicate?: boolean;
  path?: string;
}

function writeSpecRegistro(d: Decision): Written {
  const path = planPath(d.dest);
  if (!path) return { ok: false, detail: cycleWord('cycle.log.noPlan') };
  const text = readFileSync(path, 'utf8');
  const name = decisionLogHeading();
  const heading = name ? new RegExp(`^##+ .*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'm').exec(text) : null;
  if (!heading) return { ok: false, detail: cycleWord('cycle.log.noHeading', { heading: name }) };
  const start = heading.index + heading[0].length;
  const nextHeading = text.slice(start).search(/^#{1,2} /m);
  const end = nextHeading === -1 ? text.length : start + nextHeading;
  const entry = `${cp('turn.doc.logEntry', { date: today(), text: d.text })}\n`;
  // A meeting later the same day does not write again what an earlier one already wrote.
  if (text.slice(start, end).includes(entry.trim())) return { ok: true, detail: path, duplicate: true, path };
  const before = text.slice(0, end).replace(/\n*$/, '\n');
  writeFileSync(path, `${before}${entry}${end < text.length ? '\n' : ''}${text.slice(end)}`);
  return { ok: true, detail: path, path };
}

function currentNote(ref: string): string | null {
  const file = rc().cardSource?.stateFile;
  if (!file) return null;
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    const item = Object.values(state.items as Record<string, { ref: string; manual_note: string | null }>).find(
      (it) => it.ref === ref,
    );
    return item?.manual_note ?? null;
  } catch {
    return null;
  }
}

async function writeDailyNote(d: Decision): Promise<Written & { note?: string }> {
  // The card source's note command replaces the note, so the previous one is kept in front.
  const previous = currentNote(d.ref);
  const line = `${today()}: ${d.text}`;
  const note = previous ? `${previous} | ${line}` : line;
  const source = rc().cardSource;
  if (!source?.noteArgs.length) return { ok: false, detail: t('main.ata.noNotes') };
  const detail = `${basename(source.command)} note ${d.ref}`;
  if (previous?.includes(line)) return { ok: true, detail, duplicate: true };
  await run(source.command, source.noteArgs.map((a) => a.replace('{ref}', d.ref).replace('{note}', note)), { timeout: 30_000 });
  invalidateReport();
  return { ok: true, detail, note };
}

// A priority decision that can be written becomes the label change on the issue, as a proposal that waits in Actions for its own "yes".
async function proposePriority(d: Decision): Promise<Written> {
  const c = d.priority;
  if (!c || c.project === null || c.iid === null) return { ok: false, detail: t('main.priority.saved.failed', { reason: t('main.priority.dest.unidentified') }) };
  try {
    const commands = await vcsProvider().planWrite({ op: 'setIssueLabels', project: c.project, iid: c.iid, add: c.add ? [c.add] : [], remove: c.remove });
    const made = proposeVcsCommands(
      {
        key: `priority:${d.ref}:${c.label ?? c.to}:${today()}`,
        issue: c.iid,
        issueTitle: c.title,
        summary: t('main.priority.summary', { ref: d.ref, change: `${c.remove.join(', ') || t('main.priority.noLabel')} → ${c.label ?? c.to}` }),
        detail: t('main.priority.detail'),
      },
      commands,
    );
    return made.some((a) => a !== null) ? { ok: true, detail: t('main.priority.saved.proposal') } : { ok: true, detail: t('main.priority.saved.duplicate'), duplicate: true };
  } catch (e) {
    return { ok: false, detail: t('main.priority.saved.failed', { reason: (e as Error).message.split('\n')[0] }) };
  }
}

// The same decision written by an earlier version of the day, if one did.
function earlierWrite(d: Decision, earlier: { n: number; written: WrittenDecision[] }[]): number | null {
  for (const v of [...earlier].reverse()) {
    if (v.written.some((w) => w.ok && w.duplicateOf === undefined && w.target === d.target && w.dest === d.dest && w.ref === d.ref && norm(w.text ?? '') === norm(d.text))) return v.n;
  }
  return null;
}

export async function saveMinutes(m: Minutes, teams: string, selected: number[], ceremonyId?: string): Promise<SaveResult> {
  mkdirSync(ATAS, { recursive: true });
  const date = ceremonyId ? dateOfId(ceremonyId) : today();
  const version = openVersion(date, ceremonyId, m);
  const ataPath = writeVersionFile(date, version.n, minutesMarkdown(m, teams));
  const written: SaveResult['written'] = [];
  // What the index keeps about each decision (its text and where it went); the result the screen gets stays as it always was.
  const records: WrittenDecision[] = [];
  for (const i of selected) {
    const d = m.decisions[i];
    if (!d) continue;
    const record = (w: WrittenDecision) => {
      written.push({ ref: w.ref, dest: w.dest, ok: w.ok, detail: w.detail, ...(w.duplicateOf !== undefined ? { duplicateOf: w.duplicateOf } : {}) });
      records.push({ ...w, text: d.text, target: d.target });
    };
    // A priority decision that cannot be written has nothing to refuse: it is in the minutes, and its destination says why.
    if (d.target === 'priority' && (!d.priority || d.priority.noWrite)) {
      record({ ref: d.ref, dest: d.dest, ok: true, detail: ataPath });
      continue;
    }
    const blocked = d.target === 'ata' ? null : externalRefusal(d.target === 'priority' ? t('main.priority.whatWrite') : t('main.ata.whatWrite'));
    if (blocked) {
      record({ ref: d.ref, dest: d.dest, ok: false, detail: t('main.ata.testOnly') });
      continue;
    }
    const before = d.target === 'ata' || d.target === 'priority' ? null : earlierWrite(d, version.earlier);
    if (before !== null) {
      record({ ref: d.ref, dest: d.dest, ok: true, detail: cycleWord('minutes.duplicate.version', { n: before }), duplicateOf: before });
      continue;
    }
    try {
      if (d.target === 'spec') {
        const r = writeSpecRegistro(d);
        if (r.ok && r.path && !r.duplicate) recordSelfWrite(date, { file: r.path });
        record({ ref: d.ref, dest: d.dest, ok: r.ok, detail: r.detail, ...(r.duplicate ? { duplicateOf: 'document' as const } : {}) });
      } else if (d.target === 'note') {
        const r = await writeDailyNote(d);
        if (r.note) recordSelfWrite(date, { note: { ref: d.ref, text: r.note } });
        record({ ref: d.ref, dest: d.dest, ok: r.ok, detail: r.detail, ...(r.duplicate ? { duplicateOf: 'document' as const } : {}) });
      } else if (d.target === 'priority') {
        const r = await proposePriority(d);
        record({ ref: d.ref, dest: d.dest, ok: r.ok, detail: r.detail, ...(r.duplicate ? { duplicateOf: 'document' as const } : {}) });
      } else record({ ref: d.ref, dest: d.dest, ok: true, detail: ataPath });
    } catch (e) {
      record({ ref: d.ref, dest: d.dest, ok: false, detail: String(e) });
    }
  }
  commitVersion(date, version.n, { teams, written: records });
  return { ataPath, written, version: version.n };
}
