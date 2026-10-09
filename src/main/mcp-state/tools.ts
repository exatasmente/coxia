import { homedir } from 'node:os';
import { join } from 'node:path';
import { redact, redactDoc } from '../errorlog-core';
import { evidencePath } from '../evidence/store';
import { readConfigFile } from '../config-bootstrap';
import { createBoardStore } from '../board-core';
import { createForumStore } from '../forum-core';
import { createProcedureStore } from '../procedures/store';
import { createRunStore, type RunStore } from '../runs-core';
import { readRegistry, workspaceDir } from '../workspaces-core';
import { CONFIG_SCHEMA_VERSION, type Language } from '../../shared/config/types';
import { RUN_ID, type Run } from '../../shared/runs';
import type { ProcedureRecord } from '../../shared/procedures';
import { awaitsReview } from '../../shared/procedures';
import { runThreadId } from '../../shared/forum';
import { shrinkHome } from '../../shared/config/paths';
import { createSharedMemory, renderFronts, sortedFronts, type ActivityIndex } from '../runner/activities';
import { setLanguage, t } from '../../shared/i18n';

// The reads the local state server answers: the electron-free side of the app over one workspace's data folder. Everything is a pure function
// of file arguments, rebuilt at every call (what the files declare now, never a snapshot), masked the way the app masks what it shows its own
// agents (`redact` in prose, `redactDoc` on the board), and never a raw file. Two things a run never keeps in a file are never answered as if
// they existed: the worktree path, and a command set to `shell: host` that waits for the person (it is never saved with the run).

/** Text input the MCP `tools/call` arguments carry. */
export interface ToolArgs {
  runId?: unknown;
  id?: unknown;
}

export interface TextResult {
  text: string;
  isError: boolean;
}

export interface StateTool {
  name: string;
  /** Translated for the workspace language when the tool list is built (see `stateTools`). */
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: ToolArgs): TextResult;
}

interface Resolved {
  ok: true;
  dir: string;
  id: string;
  language: Language;
}

/** Why a workspace is not served, in words every tool answers with: the workspace is never guessed and never another one's. */
export function resolveWorkspace(env: NodeJS.ProcessEnv = process.env): Resolved | { ok: false; text: string } {
  const id = env.CERIMONIAS_MCP_WORKSPACE;
  if (!id) return { ok: false, text: t('main.mcpstate.workspaceMissing') };
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) return { ok: false, text: t('main.mcpstate.workspaceInvalid', { id: id.slice(0, 48) }) };
  const root = env.CERIMONIAS_DATA_DIR || join(homedir(), '.local/share/cerimonias');
  const registry = readRegistry(root);
  if (!registry || !registry.list.some((w) => w.id === id)) return { ok: false, text: t('main.mcpstate.workspaceUnknown', { id: id.slice(0, 48) }) };
  const dir = workspaceDir(root, id);
  // Served only while the workspace's own opt-in is on (its config): a config a newer app wrote, an unreadable one and a plain absence are all
  // "off", so nothing is guessed and nothing of a workspace that never asked for it leaves the machine.
  const config = readConfigFile(dir) as { schemaVersion?: unknown; mcpState?: { enabled?: unknown }; language?: unknown } | undefined;
  if (config?.schemaVersion !== CONFIG_SCHEMA_VERSION || config.mcpState?.enabled !== true) return { ok: false, text: t('main.mcpstate.workspaceOff') };
  const language: Language = config.language === 'en' ? 'en' : 'pt-BR';
  return { ok: true, dir, id, language };
}

const HOME = homedir();

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Prose as the app shows it (conversations, evidence, activities) or as the tracker shows it (the board). */
const show = (v: unknown, doc: boolean): string => (doc ? redactDoc : redact)(asText(v));

const runsStore = (dir: string): RunStore => createRunStore(join(dir, 'runs'));

const runOf = (store: RunStore, args: ToolArgs): { ok: true; run: Run } | { ok: false; text: string } => {
  if (!RUN_ID.test(asText(args.runId))) return { ok: false, text: t('main.mcpstate.badRunId', { id: asText(args.runId).slice(0, 40) }) };
  const run = store.get(asText(args.runId));
  if (!run) return { ok: false, text: t('main.mcpstate.runNotFound', { id: asText(args.runId).slice(0, 40) }) };
  return { ok: true, run };
};

/** The cycles of the workspace (its board), as the tracker view holds them, and nothing of another workspace. */
export function buildCycles(served: Resolved): string {
  const cards = createBoardStore({ file: join(served.dir, 'board.json'), now: () => new Date() })
    .list()
    .map((c) => ({
      id: c.id,
      title: show(c.title, true),
      column: c.column,
      squad: c.squad,
      priority: c.priority,
      labels: c.labels,
      repo: c.repo,
      state: c.state,
      ...(c.host ? { link: { project: c.host.project, iid: c.host.iid, url: c.host.url } } : {}),
      updatedAt: c.updatedAt,
    }));
  return cards.length ? JSON.stringify(cards, null, 1) : t('main.mcpstate.noCycles');
}

/** The runs of the workspace: stage, status, and the pending question when one is waiting. A command waiting for approval is never answered (it is not in any file). */
export function buildRuns(served: Resolved): string {
  const list = runsStore(served.dir)
    .list()
    .map((r) => ({
      id: r.id,
      issue: { ref: r.issue.ref, iid: r.issue.iid, title: show(r.issue.title, false), url: r.issue.url },
      stage: r.stage,
      status: r.status,
      squad: r.squad ?? null,
      question:
        r.status === 'question' && r.question
          ? { by: r.question.by, kind: r.question.kind, stage: r.question.stage, text: show(r.question.text, false), askedAt: r.question.askedAt }
          : null,
      pendingCommand: null,
    }));
  const body = list.length ? JSON.stringify(list, null, 1) : t('main.mcpstate.noRuns');
  return `${body}\n${t('main.mcpstate.commandsNote')}`;
}

/** A run's conversation as the run saw it, without system lines: app-worded lines render like the thread does, in order, re-masked for this answer. */
export function buildConversation(served: Resolved, args: ToolArgs): string {
  const checked = runOf(runsStore(served.dir), args);
  if (!checked.ok) return checked.text;
  const forum = createForumStore(join(served.dir, 'forum'));
  const thread = forum.read(runThreadId(checked.run.id));
  if (!thread) return t('main.mcpstate.noConversation');
  const lines = thread.messages
    .filter((m) => m.kind !== 'system')
    .map((m) => {
      const who = m.author.type === 'agent' ? m.author.id : m.author.type;
      const body = m.code ? redact(t(`main.forum.code.${m.code}`, m.params)) : show(m.text, false);
      return `[${m.seq}] ${m.at} ${who} (${m.kind}): ${body}`;
    });
  return lines.length ? lines.join('\n') : t('main.mcpstate.noConversation');
}

/** The evidence a run kept, as its stage shows it (names, what each captures, where the stored file is). */
export function buildEvidence(served: Resolved, args: ToolArgs): string {
  const checked = runOf(runsStore(served.dir), args);
  if (!checked.ok) return checked.text;
  const list = Object.values(checked.run.evidence ?? {}).map((r) => ({
    id: r.id,
    stage: r.stage,
    by: r.by,
    title: show(r.title, false),
    ...(r.description ? { description: show(r.description, false) } : {}),
    name: show(r.name, false),
    kind: r.kind,
    bytes: r.bytes,
    path: shrinkHome(evidencePath(served.dir, checked.run.id, r) ?? '', HOME),
    ...(r.removed ? { removed: r.removed } : {}),
  }));
  return list.length ? JSON.stringify(list, null, 1) : t('main.mcpstate.noEvidence');
}

/** The activities memory of the workspace, as the end of a stage sees it. */
export function buildActivities(served: Resolved): string {
  const memory = createSharedMemory(served.dir);
  const index = memory.read(runsStore(served.dir), served.language);
  const out = renderFronts(sortedFronts(index), { language: served.language, now: new Date().toISOString() });
  return out || t('main.mcpstate.activitiesEmpty');
}

/** The procedures the agents learned (#179's store, listed the way its own view lists them; never the steps). */
export function buildProcedures(served: Resolved, args: ToolArgs): string {
  const store = createProcedureStore(served.dir, { readOnly: true });
  if (typeof args.id === 'string' && args.id) {
    const got = store.get(args.id);
    if (got.status === 'ok') return JSON.stringify({ procedures: [shapeProcedure(got.record)] }, null, 1);
    return t('main.mcpstate.procedureMissing', { id: args.id.slice(0, 40) });
  }
  const { records, skipped } = store.list();
  return records.length
    ? JSON.stringify({ procedures: records.map(shapeProcedure), ...(skipped ? { unreadable: skipped } : {}) }, null, 1)
    : t('main.mcpstate.noProcedures');
}

const shapeProcedure = (r: ProcedureRecord) => ({
  id: r.id,
  revision: r.revision,
  kind: r.kind,
  key: r.key,
  title: show(r.title, false),
  state: r.state,
  reviewed: r.reviewed,
  awaitingReview: awaitsReview(r),
  savedAt: r.origin.at,
  uses: r.stats.uses,
});

const noArgs = { type: 'object', properties: {}, additionalProperties: false };

const RUN_ID_PARAM = { type: 'string', description: 'The id of a run, as a coxia_state_runs answer names it.' };

type ToolSpec = {
  name: string;
  descriptionKey: string;
  inputSchema: Record<string, unknown>;
  run: (served: Resolved, args: ToolArgs) => string;
};

/** The read tools, in the fixed order a session lists them. Every run body re-resolves the workspace and re-reads the files. */
export const TOOL_SPECS: ToolSpec[] = [
  { name: 'coxia_state_cycles', descriptionKey: 'main.mcpstate.tool.cycles', inputSchema: noArgs, run: buildCycles },
  { name: 'coxia_state_runs', descriptionKey: 'main.mcpstate.tool.runs', inputSchema: noArgs, run: buildRuns },
  {
    name: 'coxia_state_conversation',
    descriptionKey: 'main.mcpstate.tool.conversation',
    inputSchema: { type: 'object', properties: { runId: RUN_ID_PARAM }, required: ['runId'], additionalProperties: false },
    run: buildConversation,
  },
  {
    name: 'coxia_state_evidence',
    descriptionKey: 'main.mcpstate.tool.evidence',
    inputSchema: { type: 'object', properties: { runId: RUN_ID_PARAM }, required: ['runId'], additionalProperties: false },
    run: buildEvidence,
  },
  { name: 'coxia_state_activities', descriptionKey: 'main.mcpstate.tool.activities', inputSchema: noArgs, run: buildActivities },
  {
    name: 'coxia_state_procedures',
    descriptionKey: 'main.mcpstate.tool.procedures',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'A procedure id, as a coxia_state_procedures answer names it; absent: all of them.' } }, additionalProperties: false },
    run: buildProcedures,
  },
];

/** The tool map the server serves: one per read, each refusing with the workspace problem when the workspace is missing, invalid, unknown or off. */
export function stateTools(env: NodeJS.ProcessEnv): StateTool[] {
  return TOOL_SPECS.map((spec) => ({
    name: spec.name,
    // The translation in force is the workspace's language; `applyWorkspaceLanguage` set it before the list is served.
    description: t(spec.descriptionKey),
    inputSchema: spec.inputSchema,
    run(args) {
      const served = resolveWorkspace(env);
      if (!served.ok) return { text: served.text, isError: true };
      setLanguage(served.language);
      try {
        return { text: spec.run(served, args ?? {}), isError: false };
      } catch (e) {
        return { text: t('main.mcpstate.toolFailed', { detail: redact(e instanceof Error ? e.message : String(e)) }), isError: true };
      }
    },
  }));
}

/** The language the server words its answers in, from the workspace it serves. */
export function applyWorkspaceLanguage(env: NodeJS.ProcessEnv): void {
  const served = resolveWorkspace(env);
  if (served.ok) setLanguage(served.language);
}
