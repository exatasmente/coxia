import type { AuditEntry } from '../../shared/auditoria';
import { PROCEDURE_KINDS, isProcedureId, sameKey, type ProcedureKind, type ProcedureRecord, type ProcedureUse } from '../../shared/procedures';
import type { StageUsage } from '../../shared/runs/types';
import { addReport, emptyUsage, type UsageReport } from '../../shared/runs/usage';
import { procedureAuditEntry, type ProcedureAuditInput } from './audit';
import { listProcedures, procedureLine, selectProcedures, type Listed, type SelectContext } from './select';
import type { ProcedureStore, Writer } from './store';
import { contentFromInput, renderRecord, type ProcedureAnswer, type ProcedureTools } from './tools';

// One session per call that runs an agent with a session of work (a stage, a conversation answer): it holds the list the call is told, the four tools over the store,
// what the call read, reported and wrote, and a meter of what the call used. `finish` turns the reads into uses. It imports no Electron and no forum: the place the
// call works in gives it `note` (a system line there) and `audit`, so the same session serves a run's thread, a channel and a direct conversation.

export interface SessionContext {
  /** Who is writing and from where: stamped on every record the call writes. */
  writer: Writer;
  /** The run's issue number for the audit; absent outside a run. */
  issue?: number;
  /** The ids of the workspace's repositories: the only keys a `repo` or `cycle` record may have. */
  workspaceRepos: readonly string[];
  /** What the call's list is chosen by. */
  select: Omit<SelectContext, 'now'>;
  /** The person's home folder, for the validator; the machine's by default. */
  home?: string;
}

export interface SessionDeps {
  store: ProcedureStore;
  now?: () => number;
  /** A system line in the place the call works in, as a forum code with its params. A line that cannot be written is not the call's to know. */
  note?: (code: string, params: Record<string, string | number>) => void;
  audit?: (entry: Omit<AuditEntry, 'at'>) => void;
}

export interface ProcedureSession {
  /** The list the call's prompt carries; empty text when nothing fits. */
  list: Listed;
  tools: ProcedureTools;
  /** The call's `onUsage` with the meter in front of it. */
  wrapUsage(next?: (usage: UsageReport) => void): (usage: UsageReport) => void;
  /** What the call used so far, as metered. */
  usage(): StageUsage;
  /** The ids the call read with `procedures_get` (or reported), in order. */
  readIds(): string[];
  /**
   * The call ended. `done`: what it read becomes uses (a read with no failure reported is a use that worked), and what it created gets its baseline. `failed` (an error,
   * an abort): nothing is inferred. Once only; a second call returns none.
   */
  finish(outcome: 'done' | 'failed'): ProcedureUse[];
}

/** What `procedures_list` returns at most: the rest is named in a closing line. */
export const LIST_TOOL_MAX_ENTRIES = 40;
const LIST_TOOL_MAX_CHARS = 6000;
const NOTE_MAX = 160;

const STATE_ORDER = { ok: 0, unverified: 1, failing: 2 } as const;
const answer = (text: string): ProcedureAnswer => ({ text });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createProcedureSession(deps: SessionDeps, ctx: SessionContext): ProcedureSession {
  const now = deps.now ?? Date.now;
  const iso = (): string => new Date(now()).toISOString();
  const language = ctx.select.language;
  const selectCtx = (): SelectContext => ({ ...ctx.select, now: now() });

  const read = new Set<string>();
  const staled = new Set<string>();
  const reportedSteps = new Set<string>();
  const replaced = new Set<string>();
  const created = new Set<string>();
  let used = emptyUsage();
  let finished = false;

  const say = (code: string, params: Record<string, string | number>): void => {
    try {
      deps.note?.(code, { agent: ctx.writer.by, ...params });
    } catch {
      // A line that cannot be written is not the call's to know.
    }
  };
  const audit = (input: Omit<ProcedureAuditInput, 'by' | 'surface' | 'issue' | 'ref'>): void => {
    try {
      deps.audit?.(procedureAuditEntry({ ...input, by: ctx.writer.by, surface: ctx.writer.surface, issue: ctx.issue, ref: ctx.writer.ref }));
    } catch {
      // The write already happened; a failing log must not turn it into a reported failure.
    }
  };

  const records = (): ProcedureRecord[] => deps.store.list().records;
  const list = listProcedures(records(), selectCtx());

  const lineOf = (r: ProcedureRecord): string => procedureLine(r, { language, now: now(), agentsMd: ctx.select.agentsMd });

  function listTool(input: unknown): ProcedureAnswer {
    const o = isObject(input) ? input : {};
    if (o.kind !== undefined && !(PROCEDURE_KINDS as readonly unknown[]).includes(o.kind)) return answer(`kind must be one of ${PROCEDURE_KINDS.join(', ')}.`);
    if (o.key !== undefined && typeof o.key !== 'string') return answer('key must be a string.');
    const kind = o.kind as ProcedureKind | undefined;
    const key = typeof o.key === 'string' && o.key.trim() ? o.key.trim() : undefined;
    const all = records();
    let fit: ProcedureRecord[];
    if (kind === undefined && key === undefined) {
      fit = selectProcedures(all, selectCtx(), { withFailing: true });
    } else {
      const lastUsed = (r: ProcedureRecord): number => (r.stats.lastUsed ? Date.parse(r.stats.lastUsed) : Number.NEGATIVE_INFINITY);
      fit = all
        .filter((r) => (kind === undefined || r.kind === kind) && (key === undefined || sameKey(r.key, key)))
        .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || lastUsed(b) - lastUsed(a) || a.id.localeCompare(b.id));
    }
    if (!fit.length) return answer(kind === undefined && key === undefined ? 'No procedure fits this call. Name a kind and a key to look elsewhere.' : 'No procedure has that kind and key.');
    const lines: string[] = [];
    let chars = 0;
    for (const r of fit.slice(0, LIST_TOOL_MAX_ENTRIES)) {
      const line = lineOf(r);
      if (chars + line.length > LIST_TOOL_MAX_CHARS && lines.length) break;
      lines.push(line);
      chars += line.length + 1;
    }
    const more = fit.length - lines.length;
    return answer(`${lines.join('\n')}${more > 0 ? `\n${more} more not listed; name a kind and a key to narrow it.` : ''}\nRead one with procedures_get and its id.`);
  }

  function getTool(input: unknown): ProcedureAnswer {
    const id = isObject(input) ? input.id : undefined;
    if (typeof id !== 'string' || !isProcedureId(id)) return answer('id must be the id of a procedure, like p-3fa91c02. List them with procedures_list.');
    const got = deps.store.get(id);
    switch (got.status) {
      case 'ok':
        read.add(id);
        return answer(renderRecord(got.record, lineOf(got.record)));
      case 'deleted':
        return answer(`${id} was deleted by the person; it is gone. Save a new one if it is worth keeping (no id).`);
      case 'newer':
        return answer(`${id} was written by a newer app and cannot be read here.`);
      case 'invalid':
        return answer(`${id} cannot be read: its file is not a procedure.`);
      default:
        return answer(`${id} not found; save a new one (no id).`);
    }
  }

  function saveTool(input: unknown): ProcedureAnswer {
    if (!isObject(input)) return answer('Not saved: the input must be an object with kind, key, title and steps.');
    // A gui procedure is the app's draft of what the screen did, never the agent's account of a page; until a draft exists in a call there is no way to save one.
    if (input.kind === 'gui') {
      audit({ op: 'refused', code: 'gui-draft', fields: ['kind'] });
      return answer('Not saved: a gui procedure is not written from memory. The app drafts it from what the screen did and it is saved from that draft, which this call does not have. Save a repo, tool, cycle or request procedure instead, or none.');
    }
    if (input.id !== undefined && typeof input.id !== 'string') return answer('Not saved: id must be the id of the procedure you replace, like p-3fa91c02.');
    const revision = typeof input.revision === 'number' && Number.isInteger(input.revision) ? input.revision : undefined;
    const r = deps.store.save({
      input: contentFromInput(input),
      id: input.id as string | undefined,
      revision,
      writer: ctx.writer,
      repos: ctx.workspaceRepos,
      stepsFrom: 'agent',
      home: ctx.home,
    });
    if (!r.ok) {
      audit({ op: 'refused', code: r.code, fields: r.refusals?.map((x) => x.field) ?? [] });
      return answer(r.text);
    }
    const rec = r.record;
    if (r.created) created.add(rec.id);
    else replaced.add(rec.id);
    audit({ op: r.created ? 'save' : 'replace', record: rec });
    say(r.created ? 'runner.procedures.saved' : 'runner.procedures.replaced', { id: rec.id, revision: rec.revision, title: rec.title });
    return answer(
      r.created
        ? `Saved ${rec.id} at revision ${rec.revision}: "${rec.title}". It is listed for the calls it fits, marked as not reviewed by the person. To change it later, read it and save with its id and revision.`
        : `Replaced ${rec.id}: now revision ${rec.revision}, unverified until a later use confirms it. The version before it is kept once for the person.`,
    );
  }

  function staleTool(input: unknown): ProcedureAnswer {
    const o = isObject(input) ? input : {};
    if (typeof o.id !== 'string' || !isProcedureId(o.id)) return answer('id must be the id of the procedure whose step failed, like p-3fa91c02.');
    if (typeof o.step !== 'number' || !Number.isInteger(o.step)) return answer('step must be the number of the step that no longer worked, starting at 1.');
    if (o.note !== undefined && typeof o.note !== 'string') return answer('note must be a short text.');
    const id = o.id;
    const step = o.step;
    // The same step of the same procedure reported again in one call is one failure.
    const seen = `${id}:${step}`;
    if (reportedSteps.has(seen)) return answer(`Step ${step} of ${id} is already reported as failing.`);
    const r = deps.store.stale(id, step, iso());
    if (!r.ok) return answer(r.text);
    reportedSteps.add(seen);
    // The call followed the procedure, so its read is a use that failed and not one that worked.
    read.add(id);
    staled.add(id);
    audit({ op: 'stale', record: r.record, step });
    say('runner.procedures.stale', { id, step, title: r.record.title });
    const note = typeof o.note === 'string' ? o.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
    if (note) say('runner.procedures.staleNote', { id, note });
    return answer(`Marked ${id} as failing at step ${step}. Follow only the parts that still hold. When you find the way that works, read it again with procedures_get and replace it with procedures_save (its id and revision ${r.record.revision}).`);
  }

  // A handler never throws: a store that cannot read its folder is a text for the model and a line in the log, not a crash of the call.
  const guarded =
    (name: string, fn: (input: unknown) => ProcedureAnswer) =>
    async (input: unknown): Promise<ProcedureAnswer> => {
      try {
        return fn(input);
      } catch (e) {
        console.error(`[procedures] ${name} failed`, e instanceof Error ? e.message : e);
        return answer('The procedure tool could not finish. Nothing was changed; go on without it.');
      }
    };

  return {
    list,
    tools: { list: guarded('list', listTool), get: guarded('get', getTool), save: guarded('save', saveTool), stale: guarded('stale', staleTool) },
    wrapUsage(next) {
      return (u) => {
        try {
          next?.(u);
        } finally {
          used = addReport(used, u);
        }
      };
    },
    usage: () => used,
    readIds: () => [...read],
    finish(outcome) {
      if (finished) return [];
      finished = true;
      if (outcome === 'failed') return [];
      let uses: ProcedureUse[] = [];
      try {
        uses = deps.store.finishUse({ at: iso(), ref: ctx.writer.ref ?? '', usage: used, read: [...read], stale: [...staled], replaced: [...replaced], created: [...created] });
      } catch (e) {
        console.error('[procedures] could not close the uses of a call', e instanceof Error ? e.message : e);
        return [];
      }
      for (const u of uses) say(u.outcome === 'failed' ? 'runner.procedures.usedFailed' : u.outcome === 'replaced' ? 'runner.procedures.usedReplaced' : 'runner.procedures.used', { id: u.id, revision: u.revision, title: u.title });
      return uses;
    },
  };
}
