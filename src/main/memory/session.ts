// i18n-lint: allow-file what the memory tools tell a model: English by design, like the other tool texts of the engines
import type { AuditEntry } from '../../shared/auditoria';
import { CONVERSATION_ID, AGENT_ID, NOTE_ID, type MemorySurface } from '../../shared/memory';
import { redact } from '../errorlog-core';
import { STANDING_SENTENCE } from '../procedures/tools';
import type { ProcedureScreen } from '../procedures/screen';
import { fence } from '../runner/prompt';
import { memoryAuditEntry, type MemoryAuditInput } from './audit';
import { PROMPT_CAPS, TOOL_CAPS, type BuildOptions, type MemoryIndex, type Opened, type RankContext } from './index';
import { LIST_KINDS, type MemoryAnswer, type MemoryTools } from './tools';
import type { MemoryStore, Scope } from './store';

// One session per call that runs an agent: the list its prompt carries, the tools over the index and the store, and what the call opened. The tools know the call (who, where,
// which activity it is about, whether the person used its screen), so a note is always written in the caller's own folder and the caller cannot name another. It imports no
// Electron and no forum: the place the call works in gives it `note` (a system line there) and `audit`.

export interface MemorySessionContext {
  surface: MemorySurface;
  /** The agent the call runs as. */
  agent: string;
  /** The thread the call works in; null for a call with none (a question chain, a request, a ceremony). */
  conversation: string | null;
  /** The call may write: its own folder is made now and `memory_save` and `memory_remove` are offered. */
  writes: boolean;
  /** The call may have tools at all; false for the `teams` role. */
  tools: boolean;
  ref?: string | null;
  repo?: string;
  runId?: string | null;
  /** The run's issue number, for the audit of a write in a stage. */
  issue?: number;
  named?: { refs: string[]; agents: string[] };
  screen?: Pick<ProcedureScreen, 'handedOff' | 'typedIn'>;
  /** The exact-value mask of the stage's test environment, when it has one. */
  mask?: (text: string) => string;
  /** A system line in the place the call works in. */
  note?: (code: string, params: Record<string, string | number>) => void;
  /** Never wait for git (a ceremony on a voice path). */
  cacheOnly?: boolean;
  /** The person's home folder, for the validator; the machine's by default. */
  home?: string;
}

export interface MemorySessionDeps {
  store: MemoryStore;
  index: MemoryIndex;
  audit?: (entry: Omit<AuditEntry, 'at'>) => void;
  /** Where the line of what a call carried goes; the main process's output by default. */
  log?: (line: string) => void;
}

export interface MemorySession {
  /** The list the call's prompt carries; empty text when there is nothing to say. */
  list: { text: string; entries: number; chars: number; omitted: number };
  /** Undefined for the role without tools. Without `save` and `remove` when the session does not write. */
  tools: MemoryTools | undefined;
  /** The call writes: its folder exists and the write tools are offered. */
  writes: boolean;
  /** What the call opened with `memory_read`: how many excerpts and how many characters. */
  excerpts(): { count: number; chars: number };
  /** The call ended. Nothing to settle today; a call site closes it where it closes its procedures session. */
  finish(): void;
}

const answer = (text: string): MemoryAnswer => ({ text });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ENTRY_ID = /^(?:m-[0-9a-f]{8}|act:\S{1,160}|doc:r-[a-z0-9]{1,12}-[a-z0-9]{2,8}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}|sys:version|sys:roadmap)$/;

/** Why a note an agent may not read is held back, in the words the model reads. */
const HIDDEN: Record<'review' | 'foreign' | 'unsafe', string> = {
  review: 'was written in a call in which the person used the screen, and waits for their review. No agent can read it until they mark it as reviewed.',
  foreign: 'is not a note the app wrote, and waits for the person to look at it. No agent can read it until they mark it as reviewed.',
  unsafe: 'does not pass the checks the app holds notes to, and is left out until the person fixes it.',
};

export async function createMemorySession(deps: MemorySessionDeps, ctx: MemorySessionContext): Promise<MemorySession> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const scope: Scope | null = ctx.writes && ctx.tools && ctx.conversation !== null && CONVERSATION_ID.test(ctx.conversation) && AGENT_ID.test(ctx.agent) ? { conversation: ctx.conversation, agent: ctx.agent } : null;
  // The first call of an agent in a conversation makes its folder; a later call finds it. A folder that cannot be made is a call that reads.
  const writes = scope !== null && deps.store.ensureFolder(scope);
  const rank: RankContext = { conversation: ctx.conversation, agent: ctx.agent, ...(ctx.ref !== undefined ? { ref: ctx.ref } : {}), ...(ctx.repo ? { repo: ctx.repo } : {}), ...(ctx.named ? { named: ctx.named } : {}) };
  const build: BuildOptions = { ctx: rank, runId: ctx.runId, cacheOnly: ctx.cacheOnly };
  const mask = ctx.mask ?? ((text: string) => text);
  const shown = (text: string): string => mask(redact(text, ctx.home));
  let count = 0;
  let chars = 0;
  let unavailable = false;

  const say = (code: string, params: Record<string, string | number>): void => {
    try {
      ctx.note?.(code, { agent: ctx.agent, ...params });
    } catch {
      // A line that cannot be written is not the call's to know.
    }
  };
  const audit = (input: Omit<MemoryAuditInput, 'via' | 'by' | 'issue'>): void => {
    try {
      deps.audit?.(memoryAuditEntry({ ...input, via: ctx.surface, by: ctx.agent, ...(ctx.issue !== undefined ? { issue: ctx.issue } : {}) }));
    } catch {
      // The write already happened; a failing log must not turn it into a reported failure.
    }
  };
  const data = (body: string): string => `${STANDING_SENTENCE}\n<data>\n${fence(shown(body))}\n</data>`;

  async function listTool(input: unknown): Promise<MemoryAnswer> {
    const o = isObject(input) ? input : {};
    if (o.query !== undefined && typeof o.query !== 'string') return answer('query must be a string.');
    if (o.kind !== undefined && !(LIST_KINDS as readonly unknown[]).includes(o.kind)) return answer(`kind must be one of ${LIST_KINDS.join(', ')}.`);
    if (o.conversation !== undefined && (typeof o.conversation !== 'string' || !CONVERSATION_ID.test(o.conversation))) return answer('conversation must be the id of a conversation.');
    const view = { ...(typeof o.query === 'string' && o.query.trim() ? { query: o.query.trim() } : {}), ...(typeof o.kind === 'string' ? { kind: o.kind } : {}), ...(typeof o.conversation === 'string' ? { conversation: o.conversation } : {}) };
    const got = await deps.index.list(build, view, { ...TOOL_CAPS, tool: true });
    if (!got.text) return answer('Nothing in the memory matches. Try fewer words, or list without a query.');
    return answer(`${data(got.text)}\nOpen one with memory_read and its id.`);
  }

  function hiddenText(id: string, reason: keyof typeof HIDDEN): string {
    return `${id} ${HIDDEN[reason]}`;
  }

  function opened(id: string, o: Opened): string {
    switch (o.status) {
      case 'missing':
        return `There is no entry ${id}. List the memory with memory_list to see what is there.`;
      case 'hidden':
        return hiddenText(id, o.reason);
      case 'no-section':
        return `${id} has no section by that name. Its sections:\n${data(o.outline.join('\n'))}`;
      case 'ok': {
        count++;
        chars += o.text.length;
        log(`[memory] ${ctx.surface} ${ctx.agent} excerpt chars=${o.text.length}`);
        const sections = o.outline?.length && o.from === 0 ? `\nSections:\n${o.outline.join('\n')}` : '';
        const more = o.next !== null ? `\nThis is part of a longer text (${o.total} characters). Call memory_read again with from=${o.next} to continue.` : '';
        return `${data(`${o.provenance}\n\n${o.text}${sections}`)}${more}`;
      }
    }
  }

  async function readTool(input: unknown): Promise<MemoryAnswer> {
    const o = isObject(input) ? input : {};
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!ENTRY_ID.test(id)) return answer('id must be the id of an entry, like m-3fa91c02, act:app#101, doc:<run>/<name>, sys:version or sys:roadmap. List them with memory_list.');
    if (o.section !== undefined && typeof o.section !== 'string') return answer('section must be a string.');
    if (o.from !== undefined && (typeof o.from !== 'number' || !Number.isInteger(o.from) || o.from < 0)) return answer('from must be a whole number, the one the previous answer gave.');
    const got = await deps.index.open(build, id, { ...(typeof o.section === 'string' ? { section: o.section } : {}), ...(typeof o.from === 'number' ? { from: o.from } : {}) });
    return answer(opened(id, got));
  }

  async function saveTool(input: unknown): Promise<MemoryAnswer> {
    if (!scope || !writes) return answer('This call cannot write to the memory.');
    const o = isObject(input) ? input : {};
    if (o.id !== undefined && typeof o.id !== 'string') return answer('id must be the id of a note of yours, like m-3fa91c02.');
    if (o.revision !== undefined && (typeof o.revision !== 'number' || !Number.isInteger(o.revision))) return answer('revision must be the whole number memory_read showed.');
    // The activity the note concerns: the one the agent names (it must be one the app knows), else the call's own.
    let activity = ctx.ref ?? undefined;
    if (o.activity !== undefined) {
      const ref = typeof o.activity === 'string' ? o.activity.trim().replace(/^act:/, '') : '';
      if (!ref || !deps.index.knows(ref)) {
        audit({ op: 'refused', conversation: scope.conversation, agent: scope.agent, code: 'invalid', fields: ['activity'] });
        return answer('Not saved:\n- activity is not an activity the app knows; use a reference from the list (act:<reference>) or leave it out.');
      }
      activity = ref;
    }
    // What the person typed during a hand-off never enters a note: refused by field, with nothing written and no value in the log.
    const typed = (['title', 'text'] as const).filter((f) => typeof o[f] === 'string' && ctx.screen?.typedIn(o[f] as string));
    if (typed.length) {
      audit({ op: 'refused', conversation: scope.conversation, agent: scope.agent, code: 'typed', fields: typed });
      return answer(`Not saved: ${typed.join(', ')} holds text the person typed while they had the screen in this call. Rewrite ${typed.length === 1 ? 'it' : 'them'} without it, and write <value> where a value goes.`);
    }
    const res = deps.store.save({
      scope,
      ...(typeof o.id === 'string' ? { id: o.id.trim() } : {}),
      ...(typeof o.revision === 'number' ? { revision: o.revision } : {}),
      kind: o.kind,
      title: o.title,
      text: o.text,
      ...(activity ? { activity } : {}),
      ...(ctx.repo ? { repo: ctx.repo } : {}),
      // The person used the screen in this call, or in an earlier one on the same screen: what they typed may be in the text in a form the app cannot see.
      handoff: ctx.screen?.handedOff() === true,
      ...(ctx.mask ? { mask: ctx.mask } : {}),
      ...(ctx.home ? { home: ctx.home } : {}),
    });
    if (!res.ok) {
      audit({ op: 'refused', conversation: scope.conversation, agent: scope.agent, code: res.code, fields: res.refusals?.map((r) => r.field) });
      return answer(`Not saved:\n${res.text}`);
    }
    const n = res.note;
    audit({ op: res.created ? 'save' : 'replace', conversation: scope.conversation, agent: scope.agent, note: { id: n.id, kind: n.kind, title: n.title, revision: n.revision } });
    const wait = n.reviewed ? '' : " It waits for the person's review: no other agent reads it until they mark it as reviewed.";
    return answer(res.created ? `Saved ${n.id} at revision ${n.revision}.${wait}` : `Replaced ${n.id}; it is now at revision ${n.revision}.${wait}`);
  }

  async function removeTool(input: unknown): Promise<MemoryAnswer> {
    if (!scope || !writes) return answer('This call cannot write to the memory.');
    const id = isObject(input) && typeof input.id === 'string' ? input.id.trim() : '';
    if (!NOTE_ID.test(id)) return answer('id must be the id of a note of yours, like m-3fa91c02.');
    const before = deps.store.read(scope, id, 'person');
    const res = deps.store.remove(scope, id);
    if (!res.ok) {
      audit({ op: 'refused', conversation: scope.conversation, agent: scope.agent, code: res.code });
      return answer(`Not removed: ${res.text}`);
    }
    audit({ op: 'remove', conversation: scope.conversation, agent: scope.agent, ...(before.status === 'ok' ? { note: { id, kind: before.note.kind, title: before.note.title, revision: before.note.revision } } : {}) });
    return answer(`Removed ${id}.`);
  }

  // A handler never throws: a store that cannot read its folder is a text for the model and a line in the log, not a crash of the call.
  const guarded =
    (name: string, fn: (input: unknown) => Promise<MemoryAnswer>) =>
    async (input: unknown): Promise<MemoryAnswer> => {
      try {
        return await fn(input);
      } catch (e) {
        console.error(`[memory] ${name} failed`, e instanceof Error ? e.message : e);
        return answer('The memory tool could not finish. Nothing was changed; go on without it.');
      }
    };

  const tools: MemoryTools | undefined = ctx.tools
    ? {
        list: guarded('list', listTool),
        read: guarded('read', readTool),
        ...(writes ? { save: guarded('save', saveTool), remove: guarded('remove', removeTool) } : {}),
        unavailable() {
          if (unavailable) return;
          unavailable = true;
          say('runner.sharedMemory.toolsMissing', {});
        },
      }
    : undefined;

  const built = await deps.index.list(build, {}, { ...PROMPT_CAPS, tool: ctx.tools });
  // What the call carries, so "small windows" can be read back: the entries and characters of the list, and the entries left out.
  log(`[memory] ${ctx.surface} ${ctx.agent} entries=${built.entries} chars=${built.chars} omitted=${built.omitted}`);

  return {
    list: { text: built.text, entries: built.entries, chars: built.chars, omitted: built.omitted },
    tools,
    writes,
    excerpts: () => ({ count, chars }),
    finish: () => undefined,
  };
}
