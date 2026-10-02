import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Decision, Minutes, SaveResult } from '../shared/types';
import { ATAS } from './env';
import { invalidateReport } from './report';
import { ceremonyLabel, decisionLogHeading, formatClock, prompt as cp, text as cycleWord } from './cyclePrompts';
import { externalRefusal } from './workspace';
import { rc } from './workspaceConfig';
import { upperFirst } from '../shared/cycles/text';
import { modeText } from './agentVoice';
import { t } from '../shared/i18n';

const run = promisify(execFile);

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function minutesMarkdown(m: Minutes, teams: string): string {
  const lines = [
    t('main.ata.heading', { ceremony: upperFirst(ceremonyLabel()), from: formatClock(new Date(m.startedAt)), to: formatClock(new Date(m.endedAt)) }),
    '',
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

function writeSpecRegistro(d: Decision): { ok: boolean; detail: string } {
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
  const before = text.slice(0, end).replace(/\n*$/, '\n');
  writeFileSync(path, `${before}${entry}${end < text.length ? '\n' : ''}${text.slice(end)}`);
  return { ok: true, detail: path };
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

async function writeDailyNote(d: Decision): Promise<{ ok: boolean; detail: string }> {
  // `daily-report note` replaces the note, so the previous one is kept in front.
  const previous = currentNote(d.ref);
  const note = previous ? `${previous} | ${today()}: ${d.text}` : `${today()}: ${d.text}`;
  const source = rc().cardSource;
  if (!source?.noteArgs.length) return { ok: false, detail: t('main.ata.noNotes') };
  await run(source.command, source.noteArgs.map((a) => a.replace('{ref}', d.ref).replace('{note}', note)), { timeout: 30_000 });
  invalidateReport();
  return { ok: true, detail: `${basename(source.command)} note ${d.ref}` };
}

export async function saveMinutes(m: Minutes, teams: string, selected: number[]): Promise<SaveResult> {
  mkdirSync(ATAS, { recursive: true });
  const ataPath = join(ATAS, `${today()}-pre-daily.md`);
  appendFileSync(ataPath, `\n${minutesMarkdown(m, teams)}`);
  const written: SaveResult['written'] = [];
  for (const i of selected) {
    const d = m.decisions[i];
    if (!d) continue;
    const blocked = d.target === 'ata' ? null : externalRefusal(t('main.ata.whatWrite'));
    if (blocked) {
      written.push({ ref: d.ref, dest: d.dest, ok: false, detail: t('main.ata.testOnly') });
      continue;
    }
    try {
      const r =
        d.target === 'spec'
          ? writeSpecRegistro(d)
          : d.target === 'daily-report'
            ? await writeDailyNote(d)
            : { ok: true, detail: ataPath };
      written.push({ ref: d.ref, dest: d.dest, ...r });
    } catch (e) {
      written.push({ ref: d.ref, dest: d.dest, ok: false, detail: String(e) });
    }
  }
  return { ataPath, written };
}
