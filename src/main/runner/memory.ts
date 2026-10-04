import type { ForumMessage } from '../../shared/forum';
import { createTranslator, t } from '../../shared/i18n';
import { MEMORY_FILE } from '../../shared/runs';
import { redact } from '../errorlog-core';

// The cycle memory: the short record of a run, kept in MEMORY_FILE inside the cycle folder. Every stage reads it first and rewrites it, so a long run
// does not lose a decision to the folder budget or to the 40-message window of the thread. Pure text work: the executor and the service read and write
// the file, and everything here is testable without a worktree.

export { MEMORY_FILE };

/** The cap of the memory. A code constant (not configuration): over it the file is still read whole and the stage is told to shorten it. */
export const MEMORY_MAX = 10_000;

/** The sections of the memory, in the fixed order the file keeps. */
export const MEMORY_SECTIONS = ['decisions', 'constraints', 'discarded', 'questions', 'where'] as const;
export type MemorySection = (typeof MEMORY_SECTIONS)[number];

const titleKey = 'main.runner.memory.title';
const sectionKey = (id: MemorySection): string => `main.runner.memory.section.${id}`;

/** The skeleton the app writes when the memory is born (and for a run that predates it): the title and the sections, in the workspace's language. */
export function memorySkeleton(): string {
  const lines = [`# ${t(titleKey)}`];
  for (const id of MEMORY_SECTIONS) lines.push('', `## ${t(sectionKey(id))}`, '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** The memory passed its cap: it is read whole all the same, and the stage is told to bring it back to size. */
export const memoryOver = (text: string): boolean => text.length > MEMORY_MAX;

// The headings of the sections in every language the app has: a memory written before a language change (or by the model in the other language) still lands in the right section.
const headingIds = (): Map<string, MemorySection> => {
  const ids = new Map<string, MemorySection>();
  for (const lang of ['pt-BR', 'en'] as const) {
    const tr = createTranslator(lang);
    for (const id of MEMORY_SECTIONS) ids.set(tr(sectionKey(id)).trim().toLowerCase(), id);
  }
  return ids;
};

const heading = (line: string): string | null => /^##\s+(.+?)\s*$/.exec(line)?.[1] ?? null;

/**
 * The memory the model returned, brought back to the shape of the file: the title and every section, in the fixed order, with the blank lines collapsed.
 * A section the model dropped is restored empty; a section it invented is folded into what it wrote under it only when its heading is one of ours.
 */
export function normalizeMemory(text: string): string {
  const ids = headingIds();
  const body = new Map<MemorySection, string[]>(MEMORY_SECTIONS.map((id) => [id, []]));
  let current: MemorySection | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const head = heading(line);
    if (head !== null) {
      current = ids.get(head.trim().toLowerCase()) ?? null;
      continue;
    }
    if (current) (body.get(current) as string[]).push(line);
  }
  const lines = [`# ${t(titleKey)}`];
  for (const id of MEMORY_SECTIONS) {
    lines.push('', `## ${t(sectionKey(id))}`, '', (body.get(id) as string[]).join('\n').trim());
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** What the conversation must leave in the memory, with a marker taken from the message so applying it twice changes nothing. */
export interface MemoryFact {
  /** `answer:<seq>` or `handoff:<seq>`; written as an HTML comment beside the line. */
  marker: string;
  section: MemorySection;
  /** The line, without the marker. */
  line: string;
}

const FACT_MAX = 600;
const oneLine = (s: string): string => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > FACT_MAX ? `${line.slice(0, FACT_MAX)}…` : line;
};

const who = (m: ForumMessage): string => (m.author.type === 'agent' ? m.author.id : t(m.author.type === 'app' ? 'main.runner.author.app' : 'main.runner.author.person'));

/**
 * What the thread must leave in the memory: each answer the person gave, and each handoff left for a next stage, in message order. The markers come from
 * the message's own number, so the same answer never enters twice, however many times the memory is rewritten.
 */
export function factsOfThread(messages: ForumMessage[]): MemoryFact[] {
  const facts: MemoryFact[] = [];
  // The memory ships in the cycle folder the agent commits, so message text is masked the way logs are before it lands.
  for (const m of messages) {
    if (m.kind === 'answer' && m.author.type === 'person' && m.text.trim()) {
      facts.push({ marker: `answer:${m.seq}`, section: 'decisions', line: `${t('main.runner.memory.answer')}: ${oneLine(redact(m.text))}` });
    } else if (m.kind === 'handoff' && m.text.trim()) {
      const to = m.to === 'person' ? t('main.runner.author.person') : (m.to ?? t('main.runner.author.app'));
      facts.push({ marker: `handoff:${m.seq}`, section: 'where', line: `${t('main.runner.memory.handoff')} ${who(m)} → ${to}: ${oneLine(redact(m.text))}` });
    }
  }
  return facts;
}

const markerOf = (f: MemoryFact): string => `<!-- ${f.marker} -->`;
const foldOf = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

// The line that already carries what the fact says, when the model kept it but dropped the marker: it gets the marker back instead of the line twice.
function lineWith(text: string, body: string): number {
  const want = foldOf(body).slice(0, 60);
  if (!want) return -1;
  const lines = text.split('\n');
  return lines.findIndex((l) => !l.includes('<!--') && foldOf(l).includes(want));
}

// Puts a bullet at the end of its section (before the next heading); a section that is not there is appended.
function insertBullet(text: string, id: MemorySection, bullet: string): string {
  const ids = headingIds();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => {
    const head = heading(l);
    return head !== null && ids.get(head.trim().toLowerCase()) === id;
  });
  if (at < 0) return `${text.trimEnd()}\n\n## ${t(sectionKey(id))}\n\n${bullet}\n`;
  let end = at + 1;
  while (end < lines.length && heading(lines[end]) === null) end++;
  let ins = end;
  while (ins > at + 1 && !lines[ins - 1].trim()) ins--;
  const head = lines.slice(0, ins).join('\n').trimEnd();
  const rest = lines.slice(ins).join('\n').replace(/^\n+/, '');
  return `${(rest ? `${head}\n${bullet}\n\n${rest}` : `${head}\n${bullet}`).replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** Applies the facts to the memory, each one once: by its marker when it is there, and otherwise written as a bullet of its section. */
export function applyFacts(text: string, facts: MemoryFact[]): string {
  let out = text;
  for (const f of facts) {
    if (out.includes(f.marker)) continue;
    const at = lineWith(out, f.line);
    if (at >= 0) {
      const lines = out.split('\n');
      lines[at] = `${lines[at].trimEnd()} ${markerOf(f)}`;
      out = lines.join('\n');
      continue;
    }
    out = insertBullet(out, f.section, `- ${f.line} ${markerOf(f)}`);
  }
  return out;
}
