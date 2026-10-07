import { parseEvidence } from './evidence';

// The documentation the agents of the app read, kept in each repository: a `.coxia/` folder of Markdown files, each with a short header. The header is a
// small subset of YAML (`key: value`, and lists inline or in a block) read here, so no library is needed and the same code serves the screen and the tests.

export const HARNESS_DIR = '.coxia';
/** What the app writes into the folder itself: not documentation, never counted or listed. */
export const HARNESS_OWN = ['.run', '.gitignore'] as const;
export const HARNESS_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const SUMMARY_MAX = 160;

export const HARNESS_KINDS = ['overview', 'rule', 'skill', 'role'] as const;
export type HarnessKind = (typeof HARNESS_KINDS)[number];

export const INVALID_REASONS = ['no-header', 'bad-commit', 'bad-date', 'no-evidence', 'bad-evidence'] as const;
export type InvalidReason = (typeof INVALID_REASONS)[number];

export interface HarnessHeader {
  checkedCommit: string;
  checkedDate: string;
  evidence: string[];
  stages: string[];
  roles: string[];
  summary: string | null;
  /** Keys this app does not know: kept, never used, so a newer app can add fields without breaking this one. */
  extra: Record<string, string | string[]>;
}

export interface HarnessFile {
  /** Relative to the `.coxia` folder, with forward slashes. */
  path: string;
  kind: HarnessKind;
  /** The file name without `.md`; null for the overview. */
  id: string | null;
  header: HarnessHeader;
  body: string;
}

export type HarnessParse = { ok: true; file: HarnessFile } | { ok: false; path: string; kind: HarnessKind; id: string | null; reason: InvalidReason };

const FOLDERS: Record<string, HarnessKind> = { rules: 'rule', skills: 'skill', roles: 'role' };

/** What a path inside `.coxia/` is, by where it sits and never by what it says. Null for a file outside the layout. */
export function classifyHarnessPath(path: string): { kind: HarnessKind; id: string | null } | null {
  if (path === 'README.md') return { kind: 'overview', id: null };
  const m = /^(rules|skills|roles)\/([^/]+)\.md$/.exec(path);
  if (!m || !HARNESS_ID.test(m[2])) return null;
  return { kind: FOLDERS[m[1]], id: m[2] };
}

const COMMIT = /^[0-9a-f]{7,40}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (text: string): boolean => {
  if (!DATE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(text);
};

type Value = string | string[];

function unquote(text: string): string {
  const t = text.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1) : t;
}

/** The lines between the two `---` fences at the top of the file and the text after them; null when there is no closed block. */
function split(text: string): { head: string[]; body: string } | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) return null;
  return { head: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

/** `key: value`, `key: [a, b]`, and `key:` followed by `- a` lines. Null when a line is none of those. */
function pairs(head: string[]): Map<string, Value> | null {
  const out = new Map<string, Value>();
  let open: string[] | null = null;
  for (const line of head) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item) {
      if (!open) return null;
      open.push(unquote(item[1]));
      continue;
    }
    const m = /^([A-Za-z][\w-]*):(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) return null;
    const value = (m[2] ?? '').trim();
    open = null;
    if (value === '') {
      open = [];
      out.set(m[1], open);
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) return null;
      const inner = value.slice(1, -1).trim();
      out.set(m[1], inner ? inner.split(',').map(unquote).filter(Boolean) : []);
    } else {
      out.set(m[1], unquote(value));
    }
  }
  return out;
}

const asText = (v: Value | undefined): string | null => (typeof v === 'string' ? v : null);
const asList = (v: Value | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : v === '' ? [] : [v]);

/**
 * Reads one file of `.coxia/` (`path` relative to the folder). A file with no valid header is not dropped and not trusted: it comes back with the reason.
 * Null when the path is not part of the layout. Nothing here reads the disk or git.
 */
export function parseHarnessFile(path: string, text: string): HarnessParse | null {
  const at = classifyHarnessPath(path);
  if (!at) return null;
  const bad = (reason: InvalidReason): HarnessParse => ({ ok: false, path, kind: at.kind, id: at.id, reason });
  const parts = split(text);
  const map = parts && pairs(parts.head);
  if (!parts || !map) return bad('no-header');
  const commit = asText(map.get('checked-commit'));
  if (commit === null || !COMMIT.test(commit)) return bad('bad-commit');
  const date = asText(map.get('checked-date'));
  if (date === null || !validDate(date)) return bad('bad-date');
  const evidence = asList(map.get('evidence'));
  if (at.kind === 'rule' && (!map.has('evidence') || evidence.length === 0)) return bad('no-evidence');
  if (evidence.some((entry) => parseEvidence(entry) === null)) return bad('bad-evidence');
  const summary = asText(map.get('summary'))?.trim() ?? '';
  const known = new Set(['checked-commit', 'checked-date', 'evidence', 'stages', 'roles', 'summary']);
  const extra: Record<string, Value> = {};
  for (const [key, value] of map) if (!known.has(key)) extra[key] = value;
  return {
    ok: true,
    file: {
      path,
      kind: at.kind,
      id: at.id,
      header: {
        checkedCommit: commit.toLowerCase(),
        checkedDate: date,
        evidence,
        stages: asList(map.get('stages')),
        roles: asList(map.get('roles')),
        summary: summary ? summary.slice(0, SUMMARY_MAX) : null,
        extra,
      },
      body: parts.body.replace(/^\n+/, ''),
    },
  };
}

/** What a repository holds of the layout: the state the screen and the delivery work from. */
export interface HarnessEntry {
  path: string;
  kind: HarnessKind;
  id: string | null;
  parse: HarnessParse;
  size: number;
  mtimeMs: number;
}

export interface HarnessState {
  repo: string;
  /** False when the repository has no `.coxia/` folder. */
  exists: boolean;
  entries: HarnessEntry[];
  /** Files in the folder that the app does not read (outside the layout, too big), relative to it. */
  ignored: string[];
  /** Name, size and mtime of the entries: changes when a file of the folder does. */
  signature: string;
}
