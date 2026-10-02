import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry } from '../shared/auditoria';
import { ATAS } from './env';
import type { Module } from './module';

const FILE = join(ATAS, 'auditoria.jsonl');
const FIELD_MAX = 300;
const RESULT_MAX = 300;
const LIST_MAX = 2000;

// Tokens never reach the log, not even inside an error message echoed by glab or curl.
const SECRETS = [/glpat-[\w-]+/g, /sk-or-[\w-]+/g, /\b(?:ghp|gho|ghu|ghs|ghr)_[\w]{20,}/g, /github_pat_[\w]{20,}/g, /\bATBB[\w-]{16,}/g, /\bBasic\s+[\w+/=]{12,}/g, /(PRIVATE-TOKEN|Authorization)[:=]\s*\S+/gi, /(token=)[^\s&"']+/gi];

export function scrub(text: string): string {
  return SECRETS.reduce((t, re) => t.replace(re, (m, p1) => (typeof p1 === 'string' ? `${p1}[removido]` : '[removido]')), text);
}

function cut(text: string, max: number): string {
  const t = scrub(text);
  return t.length > max ? `${t.slice(0, max)}… (${t.length} caracteres)` : t;
}

export function recordWrite(entry: Omit<AuditEntry, 'at'>): void {
  try {
    const line: AuditEntry = {
      ...entry,
      at: new Date().toISOString(),
      target: scrub(entry.target),
      fields: Object.fromEntries(Object.entries(entry.fields).map(([k, v]) => [k, cut(v, FIELD_MAX)])),
      result: cut(entry.result, RESULT_MAX),
    };
    mkdirSync(ATAS, { recursive: true });
    appendFileSync(FILE, `${JSON.stringify(line)}\n`);
  } catch (e) {
    // The write already happened; a failing log must not turn it into a reported failure.
    console.error('[auditoria]', e);
  }
}

export function listAudit(): AuditEntry[] {
  if (!existsSync(FILE)) return [];
  const rows: AuditEntry[] = [];
  for (const l of readFileSync(FILE, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      rows.push(JSON.parse(l) as AuditEntry);
    } catch {}
  }
  return rows.reverse().slice(0, LIST_MAX);
}

export const register: Module = (ctx) => {
  ctx.handle('auditoria:list', () => listAudit());
};
