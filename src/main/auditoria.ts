import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry } from '../shared/auditoria';
import { ATAS } from './env';
import type { Module } from './module';

const FILE = join(ATAS, 'auditoria.jsonl');
const FIELD_MAX = 300;
const RESULT_MAX = 300;
const LIST_MAX = 2000;
// The last line is read from the end of the file, not the whole log: a line is a few kilobytes at most (fields and result are cut).
const TAIL_BYTES = 64 * 1024;

// Tokens never reach the log, not even inside an error message echoed by glab or curl.
const SECRETS = [/glpat-[\w-]+/g, /sk-or-[\w-]+/g, /\b(?:ghp|gho|ghu|ghs|ghr)_[\w]{20,}/g, /github_pat_[\w]{20,}/g, /\bATBB[\w-]{16,}/g, /\b(?:Bearer|Basic)\s+[\w.~+/=-]{8,}/g, /(PRIVATE-TOKEN|Authorization)[:=]\s*\S+/gi, /(token=)[^\s&"']+/gi];

export function scrub(text: string): string {
  return SECRETS.reduce((t, re) => t.replace(re, (m, p1) => (typeof p1 === 'string' ? `${p1}[removido]` : '[removido]')), text);
}

function cut(text: string, max: number): string {
  const t = scrub(text);
  return t.length > max ? `${t.slice(0, max)}… (${t.length} caracteres)` : t;
}

const link = (prev: string, body: string): string => createHash('sha256').update(prev).update(body).digest('hex');

/** The `chain` of the last line that has one, or `''` when the log has none yet (the chain starts there). */
function lastChain(): string {
  if (!existsSync(FILE)) return '';
  const fd = openSync(FILE, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const chain = (JSON.parse(lines[i]) as AuditEntry).chain;
        if (typeof chain === 'string') return chain;
      } catch {}
    }
    return '';
  } finally {
    closeSync(fd);
  }
}

export function recordWrite(entry: Omit<AuditEntry, 'at' | 'chain' | 'tampered'>): void {
  try {
    // The chain and the reader's mark are the log's own: a caller never sets them.
    const { chain: _c, tampered: _t, ...rest } = entry as AuditEntry;
    const line: AuditEntry = {
      ...rest,
      at: new Date().toISOString(),
      target: scrub(entry.target),
      fields: Object.fromEntries(Object.entries(entry.fields).map(([k, v]) => [k, cut(v, FIELD_MAX)])),
      result: cut(entry.result, RESULT_MAX),
    };
    mkdirSync(ATAS, { recursive: true });
    // Each line seals the one before it: an edit or a removal made afterwards, by anything that is not this writer, shows up on reading.
    const chain = link(lastChain(), JSON.stringify(line));
    appendFileSync(FILE, `${JSON.stringify({ ...line, chain })}\n`);
  } catch (e) {
    // The write already happened; a failing log must not turn it into a reported failure.
    console.error('[auditoria]', e);
  }
}

export function listAudit(): AuditEntry[] {
  if (!existsSync(FILE)) return [];
  const rows: AuditEntry[] = [];
  let prev = '';
  let started = false;
  for (const l of readFileSync(FILE, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let row: AuditEntry;
    try {
      row = JSON.parse(l) as AuditEntry;
    } catch {
      continue;
    }
    const { chain, tampered: _, ...body } = row;
    if (typeof chain === 'string') {
      // Checked against the chain the previous line keeps, not a recomputed one: one edited line is flagged alone, not every line after it.
      if (link(prev, JSON.stringify(body)) !== chain) row.tampered = true;
      prev = chain;
      started = true;
    } else if (started) {
      // Lines older than the chain have none; one without it after the chain started was put there by hand.
      row.tampered = true;
    }
    rows.push(row);
  }
  return rows.reverse().slice(0, LIST_MAX);
}

export const register: Module = (ctx) => {
  ctx.handle('auditoria:list', () => listAudit());
};
