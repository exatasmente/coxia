import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TempoDay } from '../shared/tempo';
import { ATAS } from './env';
import type { Module } from './module';
import { getHistory, listHistory } from './state';
import { rc } from './workspaceConfig';
import { type GateFile, type QaFile, type RetroFile, type Span, type Timed, buildDay, ceremonySpans, deepSpans, gateSpan, localDate, qaSpan, retroSpan } from './tempo-core';

const OUT = join(ATAS, 'atividade');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function timedFiles<T>(dir: string): Timed<T>[] {
  const full = join(ATAS, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        const file = join(full, f);
        return [{ data: JSON.parse(readFileSync(file, 'utf8')) as T, mtime: statSync(file).mtimeMs }];
      } catch {
        return [];
      }
    });
}

export function spansOf(date: string): Span[] {
  const spans: Span[] = [];
  for (const entry of listHistory().filter((e) => e.date === date)) {
    const s = getHistory(entry.id);
    if (!s) continue;
    const mtime = statSync(join(ATAS, 'historico', `${entry.id}.json`)).mtimeMs;
    spans.push(...ceremonySpans(s, mtime, rc().issues.refPrefix), ...deepSpans(s));
  }
  spans.push(
    ...timedFiles<GateFile>('gates').map(gateSpan),
    ...timedFiles<QaFile>('qa').map(qaSpan),
    ...timedFiles<RetroFile>('retros').map(retroSpan),
  );
  return spans;
}

// Written again on every call: the file is a snapshot of the day, not an append log.
export function exportDay(date = localDate(Date.now())): TempoDay {
  if (!DATE.test(date)) throw new Error(`data inválida: ${date}`);
  const file = join(OUT, `${date}.json`);
  const day = buildDay(date, spansOf(date), file);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(day, null, 2));
  renameSync(`${file}.tmp`, file);
  return day;
}

export const tempo: Module = (ctx) => {
  ctx.handle('tempo:day', (date?: string) => exportDay(date));
  ctx.job({ name: 'tempo-export', everyMin: 20, workHoursOnly: true, run: async () => void exportDay() });
};
