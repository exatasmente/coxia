import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Decision, Minutes, SaveResult } from '../shared/types';
import { ATAS } from './env';
import { invalidateReport } from './report';
import { externalRefusal } from './workspace';
import { rc } from './workspaceConfig';

const run = promisify(execFile);

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function minutesMarkdown(m: Minutes, teams: string): string {
  const lines = [
    `## Pré-daily ${new Date(m.startedAt).toLocaleTimeString('pt-BR')} às ${new Date(m.endedAt).toLocaleTimeString('pt-BR')}`,
    '',
    '### Decisões',
    ...(m.decisions.length ? m.decisions.map((d) => `- ${d.ref}: ${d.text} → ${d.dest}`) : ['- nenhuma']),
    '',
    '### Efeitos aguardando "sim" no Claude Code',
    ...(m.effects.length ? m.effects.map((e) => `- ${e.ref} (${e.repo}): ${e.text}`) : ['- nenhum']),
    '',
    '### Perguntas sem resposta',
    ...(m.unanswered.length ? m.unanswered.map((u) => `- ${u.ref}: ${u.question}`) : ['- nenhuma']),
    '',
    '### Texto para a daily do time',
    '',
    '```',
    teams,
    '```',
    '',
    '### Transcrição',
    ...m.transcript.map((t) => `- ${t.at} **${t.who}**: ${t.text}`),
    '',
  ];
  return lines.join('\n');
}

function planPath(dest: string): string | null {
  const path = dest.replace(/ › Registro$/, '');
  return path.endsWith('.md') && existsSync(path) ? path : null;
}

function writeSpecRegistro(d: Decision): { ok: boolean; detail: string } {
  const path = planPath(d.dest);
  if (!path) return { ok: false, detail: 'issue sem Plan: ficou só na ata' };
  const text = readFileSync(path, 'utf8');
  const heading = /^##+ .*Registro.*$/m.exec(text);
  if (!heading) return { ok: false, detail: 'Plan sem seção Registro: ficou só na ata' };
  const start = heading.index + heading[0].length;
  const nextHeading = text.slice(start).search(/^#{1,2} /m);
  const end = nextHeading === -1 ? text.length : start + nextHeading;
  const entry = `- ${today()} (pré-daily por voz): ${d.text}\n`;
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
  if (!source?.noteArgs.length) return { ok: false, detail: 'a fonte de cartões não grava notas: ficou só na ata' };
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
    const blocked = d.target === 'ata' ? null : externalRefusal('gravar no Plan ou na nota do daily-report');
    if (blocked) {
      written.push({ ref: d.ref, dest: d.dest, ok: false, detail: 'workspace de testes: ficou só na ata' });
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
