import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AuditEntry } from '../shared/auditoria';
import { getTerms, t } from '../shared/i18n';
import { crRef } from '../shared/vcs';
import { type ConflictResolve, type HunkChoice, conflictStep, hunkReady } from '../shared/conflict';
import { isStageKind } from '../shared/cycles/stages';
import type { AppEvent, Card, ReleaseAction, VcsCommand } from '../shared/types';
import { conflictAsk, conflictPropose as askProposal, issueRef, rewriteQaComment, secretPath } from './agents';
import { recordWrite } from './auditoria';
import { runStore } from './runs';
import { getSettings } from './config';
import {
  applyResolutions,
  assertPublishable,
  commitMerge,
  conflictsDir,
  findClone,
  git,
  prepareWorktree,
  pushBranch,
  removeWorktree,
  reopenResolutions,
  runVerify,
} from './conflictGit';
import { assertResolvable, resolveMr } from './conflictFromMr';
import { hasMarkers } from './conflictHunks';
import { verifyCommandFor } from './conflictVerify';
import { cycle, formatTime, prompt as cp } from './cyclePrompts';
import { ATAS } from './env';
import type { Notice } from './scheduler';
import { assertExternalWrite } from './workspace';
import { VcsError } from './vcs/errors';
import { type ReleaseUnit, alwaysWaits, isReleasePush, parseReleaseUnit, releaseBlockers, releaseWaits, soleMaintainerOf } from '../shared/release';
import { type ReleasePr, previewRelease, releaseCommandLine, runReleaseOp, sameSha } from './releaseGit';
import { type VcsRuntime, vcsProvider, vcsRuntime } from './vcs';
import { STATUS_MUTATION } from './vcs/gitlab';
import type { ExecMeta } from './vcs/types';
import { auditFieldsOf, auditKindOf, commandKind, validateVcsCommand } from './vcs/validate';
import { type Identity, commitIdentity } from './runner/git';
import { getConfig, issueProjectKey, primaryKind, qaNoteMarker, rc, requireVcsHost } from './workspaceConfig';
import { tv } from '../shared/i18n';

/** The workspace's word for a change request (MR, PR), for a notification of an action that has no ref. */
const crWord = (): string => getTerms().words.cr;

const exec = promisify(execFile);
const FILE = join(ATAS, 'acoes.json');
const PIPELINE_WAIT_MS = 30_000;
// The GitLab status mutation lives with its provider; re-exported for the callers and tests that knew it here.
export { STATUS_MUTATION };

interface Store {
  releaseSeen: string | null;
  actions: ReleaseAction[];
}

interface Unit {
  issue_iid: number;
  issue_title: string;
  stage: string;
  mr_ref: string;
  mr_url: string;
  source_branch: string;
  atras: number;
  mine: boolean;
  bloqueado: boolean;
  status: string;
  tgt_sha: string;
  conflitos: string[];
  overlap?: { arquivos?: string[] };
  repo: string;
  src_sha: string;
  project_path?: string;
  mr_iid?: number;
  target_branch?: string;
}

let deps: { notify(n: Notice): void; emit(ev: AppEvent): void } | null = null;
let detecting = false;

function read(): Store {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as Store;
  } catch {}
  return { releaseSeen: null, actions: [] };
}

function write(s: Store): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s, null, 1));
  renameSync(`${FILE}.tmp`, FILE);
  deps?.emit({ type: 'actions', actions: s.actions });
}

function update(id: string, change: (a: ReleaseAction) => ReleaseAction): ReleaseAction {
  const s = read();
  const i = s.actions.findIndex((a) => a.id === id);
  if (i < 0) throw new Error(t('main.actions.missing', { id }));
  s.actions[i] = change(s.actions[i]);
  write(s);
  return s.actions[i];
}

async function cli(args: string[]): Promise<string> {
  try {
    const sync = rc().releaseSync;
    if (!sync) throw new Error(t('main.actions.noSyncTool'));
    const { stdout, stderr } = await exec(sync.command, args, { cwd: sync.cwd, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${err.stdout ?? ''}\n${err.stderr ?? err.message}`.trim());
  }
}

function blank(partial: Partial<ReleaseAction> & Pick<ReleaseAction, 'key' | 'kind' | 'issue'>): ReleaseAction {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    issueTitle: '',
    stage: '',
    release: null,
    mrs: [],
    files: [],
    retest: false,
    state: 'pending',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    output: null,
    noteId: null,
    currentBody: null,
    proposedBody: null,
    sessionId: null,
    msgs: [],
    unit: null,
    summary: null,
    command: null,
    resolve: null,
    ...partial,
  };
}

function describe(c: VcsCommand): string {
  const fields = Object.entries(c.fields).map(([k, v]) => `  ${k} = ${v.length > 300 ? `${v.slice(0, 300)}… (${t('main.actions.chars', { count: v.length })})` : v}`);
  if (c.json !== undefined) fields.push(`  body = ${c.json.length > 600 ? `${c.json.slice(0, 600)}… (${t('main.actions.chars', { count: c.json.length })})` : c.json}`);
  return [`${c.method} ${c.endpoint}  (via ${c.via})`, ...fields].join('\n');
}

/** Throws the reason when a write command has a shape the app may not run. Routes by the command's provider (GitLab when it names none). */
export const validateGitlabCommand = validateVcsCommand;
export { validateVcsCommand };

/** A proposal of the same thing from the same run (a newer text of the comment that still waits) replaces the one that waits: only the latest is worth a "sim". */
function supersede(list: ReleaseAction[], unit: Record<string, unknown> | undefined): ReleaseAction[] {
  if (!unit?.runId || !unit.key || !unit.purpose) return list;
  const at = new Date().toISOString();
  return list.map((a) => (a.state === 'pending' && a.unit?.runId === unit.runId && a.unit?.key === unit.key && a.unit?.purpose === unit.purpose ? { ...a, state: 'skipped' as const, finishedAt: at, output: t('main.actions.replaced') } : a));
}

/**
 * Any module proposes a write to the code host here (GitLab, GitHub or Bitbucket). Nothing runs until the user says "seguir" and
 * confirms in the Actions screen. `key` deduplicates: the same proposal is not created (nor notified) twice.
 */
export function proposeVcsAction(input: {
  key: string;
  issue: number;
  issueTitle?: string;
  stage?: string;
  summary: string;
  detail?: string;
  command: VcsCommand;
  notify?: { title: string; body: string };
  /** What the module that proposed it needs to recognise it when it is done (the runner's comments and pull request). */
  unit?: Record<string, unknown>;
}): ReleaseAction | null {
  validateVcsCommand(input.command);
  const store = read();
  if (store.actions.some((a) => a.key === input.key && (a.state === 'pending' || a.state === 'running' || a.state === 'done'))) return null;
  const action = blank({
    key: input.key,
    // Actions saved before providers existed are 'gitlab'; GitLab proposals keep that kind so nothing about them changes.
    kind: commandKind(input.command) === 'gitlab' ? 'gitlab' : 'vcs',
    issue: input.issue,
    issueTitle: input.issueTitle ?? '',
    stage: input.stage ?? '',
    summary: input.summary,
    command: input.command,
    unit: input.unit ?? null,
    output: [input.detail, describe(input.command)].filter(Boolean).join('\n\n'),
  });
  write({ ...store, actions: [action, ...supersede(store.actions, input.unit)] });
  if (input.notify && getSettings().notifications) deps?.notify({ ...input.notify, onClick: { type: 'navigate', to: 'actions' } });
  return action;
}

/**
 * Several writes that are one thing to the person (a review round: its comments, its replies and its verdict) wait in one proposal, for one "sim". They run
 * in order; the first that fails stops the rest, and approving again goes on from there. A group of one is an ordinary proposal.
 */
export function proposeVcsGroup(input: Omit<Parameters<typeof proposeVcsAction>[0], 'command'>, commands: VcsCommand[]): ReleaseAction | null {
  if (!commands.length) return null;
  if (commands.length === 1) return proposeVcsAction({ ...input, command: commands[0] });
  for (const c of commands) validateVcsCommand(c);
  const store = read();
  if (store.actions.some((a) => a.key === input.key && (a.state === 'pending' || a.state === 'running' || a.state === 'done'))) return null;
  const action = blank({
    key: input.key,
    kind: commands.every((c) => commandKind(c) === 'gitlab') ? 'gitlab' : 'vcs',
    issue: input.issue,
    issueTitle: input.issueTitle ?? '',
    stage: input.stage ?? '',
    summary: input.summary,
    command: commands[0],
    commands,
    done: 0,
    unit: input.unit ?? null,
    output: [input.detail, ...commands.map((c, i) => `${i + 1}/${commands.length}  ${describe(c)}`)].filter(Boolean).join('\n\n'),
  });
  write({ ...store, actions: [action, ...supersede(store.actions, input.unit)] });
  if (input.notify && getSettings().notifications) deps?.notify({ ...input.notify, onClick: { type: 'navigate', to: 'actions' } });
  return action;
}

// ---- what a module learns when a proposal it made is carried out --------------------------------------------------------------------------

/** What the host answered to each write of a proposal that ran (parsed JSON when it was one). */
export type ActionListener = (action: ReleaseAction, responses: unknown[]) => void;
const listeners = new Set<ActionListener>();

/** Tells `fn` after any proposal is carried out. Returns the way to stop. */
export function onActionDone(fn: ActionListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function told(action: ReleaseAction, responses: unknown[]): void {
  for (const fn of listeners) {
    try {
      fn(action, responses);
    } catch (e) {
      console.error('[actions] listener', e);
    }
  }
}

/** A "sim" that was refused before anything ran (a release step whose earlier step in the same stage is not done): the action and the reason the person was given. */
export type RefusalListener = (action: ReleaseAction, reason: string) => void;
const refusalListeners = new Set<RefusalListener>();

/** Tells `fn` when an approval is refused before anything ran. Returns the way to stop. */
export function onActionRefused(fn: RefusalListener): () => void {
  refusalListeners.add(fn);
  return () => void refusalListeners.delete(fn);
}

function refused(action: ReleaseAction, reason: string): Error {
  for (const fn of refusalListeners) {
    try {
      fn(action, reason);
    } catch (e) {
      console.error('[actions] listener', e);
    }
  }
  return new Error(reason);
}

/** The name the function had when GitLab was the only host. */
export const proposeGitlabAction = proposeVcsAction;

/** One proposal per command of a planned write (a label change on GitHub is several calls); the first keeps the key, the rest get a suffix. */
export function proposeVcsCommands(input: Omit<Parameters<typeof proposeVcsAction>[0], 'command'>, commands: VcsCommand[]): (ReleaseAction | null)[] {
  return commands.map((command, i) => proposeVcsAction({ ...input, key: i === 0 ? input.key : `${input.key}#${i + 1}`, notify: i === 0 ? input.notify : undefined, command }));
}

/** The runtime that serves a command: the primary integration when it is of the command's kind, else the first one that is. */
function runtimeFor(c: VcsCommand): VcsRuntime {
  const kind = commandKind(c);
  const primary = vcsRuntime();
  if (primary?.settings.kind === kind) return primary;
  const other = rc().vcs.find((v) => v.kind === kind);
  const found = other ? vcsRuntime(other.id) : null;
  if (!found) throw new VcsError('not_configured', { kind });
  return found;
}

async function runVcs(c: VcsCommand, meta: ExecMeta = {}): Promise<string> {
  return runtimeFor(c).exec.run(c, meta);
}

const isVcsAction = (a: ReleaseAction): boolean => (a.kind === 'gitlab' || a.kind === 'vcs') && !!a.command;

export function listActions(): ReleaseAction[] {
  return read().actions;
}

export async function detectRelease(manual: boolean): Promise<string> {
  if (detecting) return t('main.actions.alreadyChecking');
  if (!rc().releaseSync) return t('main.actions.noSyncTool');
  detecting = true;
  try {
    const status = await cli(['status']);
    const release = /Release mais recente:\s*(\S+).*?,\s*([0-9a-f]{7,})\)/.exec(status);
    const name = release?.[1] ?? null;
    const store = read();
    if (!manual && (!/HOUVE RELEASE NOVA/.test(status) || store.releaseSeen === release?.[2])) return status;

    const units = (JSON.parse(await cli(['scan', '--mine', '--format', 'json'])) as Unit[]).filter((u) => u.mine && !u.bloqueado);
    const known = new Set(store.actions.map((a) => a.key));
    const fresh: ReleaseAction[] = [];

    for (const u of units.filter((x) => x.status === 'CONFLITO')) {
      const key = `conflict:${u.mr_ref}:${u.tgt_sha}`;
      if (known.has(key)) continue;
      fresh.push(
        blank({
          key,
          kind: 'conflict',
          issue: u.issue_iid,
          issueTitle: u.issue_title,
          stage: u.stage,
          release: name,
          mrs: [{ ref: u.mr_ref, url: u.mr_url, branch: u.source_branch, behind: u.atras }],
          files: u.conflitos,
          unit: u as unknown as Record<string, unknown>,
        }),
      );
    }

    const toSync = units.filter((x) => x.status.startsWith('SINCRONIZADA'));
    for (const issue of [...new Set(toSync.map((u) => u.issue_iid))]) {
      const mine = toSync.filter((u) => u.issue_iid === issue);
      const key = `sync:${issue}:${mine.map((u) => `${u.mr_ref}@${u.tgt_sha}`).join(',')}`;
      if (known.has(key)) continue;
      fresh.push(
        blank({
          key,
          kind: 'sync',
          issue,
          issueTitle: mine[0].issue_title,
          stage: mine[0].stage,
          release: name,
          mrs: mine.map((u) => ({ ref: u.mr_ref, url: u.mr_url, branch: u.source_branch, behind: u.atras })),
          files: [...new Set(mine.flatMap((u) => u.overlap?.arquivos ?? []))],
          retest: mine.some((u) => u.status === 'SINCRONIZADA_COM_RETESTE'),
          unit: mine[0] as unknown as Record<string, unknown>,
        }),
      );
    }

    write({ releaseSeen: release?.[2] ?? store.releaseSeen, actions: [...fresh, ...store.actions] });

    const notify = getSettings().notifications ? deps?.notify : undefined;
    for (const a of fresh.filter((x) => x.kind === 'conflict')) {
      notify?.({
        title: t('main.actions.conflictTitle', { issue: a.issue }),
        body: t('main.actions.conflictBody', { ref: a.mrs[0].ref, count: a.files.length }),
        onClick: { type: 'conflict', id: a.id },
      });
    }
    const syncs = fresh.filter((x) => x.kind === 'sync');
    if (syncs.length) {
      notify?.({
        title: t('main.actions.syncTitle', { name: name ?? t('main.actions.newRelease'), count: syncs.length }),
        body: t('main.actions.syncBody', { issues: syncs.map((a) => `#${a.issue}`).join(', ') }),
        onClick: { type: 'navigate', to: 'actions' },
      });
    }
    if (!fresh.length && manual) {
      notify?.({ title: t('main.actions.postReleaseTitle'), body: t('main.actions.nothingToSync'), onClick: { type: 'navigate', to: 'actions' } });
    }
    return fresh.length ? t('main.actions.newActions', { count: fresh.length }) : t('main.actions.nothingToSync');
  } finally {
    detecting = false;
  }
}

export async function previewAction(id: string): Promise<string> {
  const a = read().actions.find((x) => x.id === id);
  if (!a) throw new Error(t('main.actions.missing', { id }));
  if (isVcsAction(a)) return describe(a.command as VcsCommand);
  if (a.kind === 'sync') return cli(['sync', '--issue', String(a.issue)]);
  if (a.kind === 'qa-comment') return a.proposedBody ?? cli(['publish', '--dump', '--issue', String(a.issue)]);
  if (a.kind === 'plugin-write') return a.output ?? '';
  if (a.kind === 'conflict-push') return a.output ?? '';
  if (a.kind === 'run-push') return a.output ?? '';
  if (a.kind === 'release-git') return previewReleaseAction(a);
  return a.files.join('\n');
}

async function qaNote(issue: number): Promise<{ id: number; body: string } | null> {
  const notes = await vcsProvider().listIssueComments(issueProjectKey(), issue);
  const marker = qaNoteMarker();
  const note = marker ? notes.find((n) => !n.system && marker.test(n.body.trim())) : undefined;
  return note ? { id: Number(note.id), body: note.body } : null;
}

// After a sync, the QA comment is a separate action: authorization does not carry over (the release tool's own rule).
async function proposeQaComment(sync: ReleaseAction): Promise<void> {
  // An issue still in code review has nothing to retest yet.
  if (isStageKind(cycle(), sync.stage, ['review'])) return;
  const base = { key: `qa-comment:${sync.issue}:${sync.id}`, kind: 'qa-comment' as const, issue: sync.issue, issueTitle: sync.issueTitle, stage: sync.stage, release: sync.release, mrs: sync.mrs, files: sync.files, retest: sync.retest, unit: sync.unit };
  const note = await qaNote(sync.issue);
  let action: ReleaseAction;
  if (note) {
    const r = await rewriteQaComment(sync.issue, note.body, sync.output ?? '', sync.unit);
    action = blank({ ...base, noteId: note.id, currentBody: note.body, proposedBody: r.body, output: r.summary });
  } else {
    action = blank({ ...base, output: t('main.actions.noQaNote') });
  }
  const s = read();
  write({ ...s, actions: [action, ...s.actions] });
  if (getSettings().notifications) {
    deps?.notify({
      title: t('main.actions.syncedTitle', { issue: sync.issue }),
      body: note ? t('main.actions.noteProposed') : t('main.actions.noteByTool'),
      onClick: { type: 'navigate', to: 'actions' },
    });
  }
}

type AuditBase = Pick<AuditEntry, 'kind' | 'target' | 'via' | 'fields'>;

/** Where a write came from, for the audit line: a proposal the person approved, or a write an agent's autonomy let go out. */
export interface AuditOrigin {
  issue: number;
  actionId: string;
  kind: string;
  key: string;
  summary: string | null;
  by?: string;
  bodyHash?: string;
}

const originOf = (a: ReleaseAction): AuditOrigin => ({ issue: a.issue, actionId: a.id, kind: a.kind, key: a.key, summary: a.summary });

// Every real write goes through here: one line in auditoria.jsonl, whatever the outcome.
async function audited(from: AuditOrigin, base: AuditBase, write: (meta: ExecMeta) => Promise<string>): Promise<string> {
  assertExternalWrite(t('vcs.write.guard'));
  const meta: ExecMeta = {};
  const entry = {
    ...base,
    issue: from.issue,
    origin: { actionId: from.actionId, kind: from.kind, key: from.key, summary: from.summary },
    ...(from.by ? { by: from.by } : {}),
    ...(from.bodyHash ? { bodyHash: from.bodyHash } : {}),
  };
  try {
    const out = await write(meta);
    recordWrite({ ...entry, ok: true, code: meta.code ?? null, result: out });
    return out;
  } catch (e) {
    const message = String((e as Error).message);
    const code = meta.code ?? (e instanceof VcsError && e.status ? e.status : Number(/(?:respondeu|responded|HTTP(?: error)?:?)\s*(\d{3})/i.exec(message)?.[1] ?? NaN));
    recordWrite({ ...entry, ok: false, code: Number.isNaN(code) ? null : code, result: message });
    throw e;
  }
}

/** One write to the code host that an agent's autonomy lets go out without a "sim": the same door, the same audit log, with the agent as who and the body's hash. */
export interface AutoWrite {
  issue: number;
  key: string;
  summary: string;
  by: string;
  bodyHash?: string;
}

export async function runVcsAuto(w: AutoWrite, c: VcsCommand): Promise<unknown> {
  validateVcsCommand(c);
  let response: unknown;
  await audited({ issue: w.issue, actionId: `auto:${w.key}`, kind: 'auto', key: w.key, summary: w.summary, by: w.by, bodyHash: w.bodyHash }, { kind: auditKindOf(c), target: `${c.method} ${c.endpoint}`, via: c.via, fields: auditFieldsOf(c) }, async (meta) => {
    const out = await runVcs(c, meta);
    response = meta.response;
    return out;
  });
  return response;
}

export async function approveAction(id: string): Promise<ReleaseAction> {
  assertExternalWrite(t('vcs.write.guard'));
  const a = read().actions.find((x) => x.id === id);
  if (!a) throw new Error(t('main.actions.missing', { id }));
  if (a.state !== 'pending' && a.state !== 'failed') throw new Error(t('main.actions.handled'));
  if (a.kind === 'conflict') throw new Error(tv('err.conflictOpenCall'));
  // A plugin's request is answered with how far the "yes" reaches, on the computer (plugins:answer); it is not a write to approve. An announced write goes
  // out at its deadline, after the service checked the plugin is still on and still allowed: there is no way to send it earlier.
  if (a.kind === 'plugin-ask') throw new Error(t('main.plugins.ask.answerHere'));
  if (a.kind === 'plugin-write') throw new Error(t('main.plugins.write.atDeadline'));
  // A refusal here leaves the action as it was: nothing ran.
  if (a.kind === 'conflict-push') await checkPublishable(a);
  if (a.kind === 'release-git') {
    // A step asked in the same stage as one it needs (the push of a beta before its cut) waits for it: run first, it would send what the remote already has.
    const first = releaseBlockers(a, read().actions);
    if (first.length) throw refused(a, t('main.release.waitsForStep', { step: a.summary ?? '', first: first.map((b) => b.summary ?? b.key).join('; ') }));
  }
  update(id, (x) => ({ ...x, state: 'running' }));
  const responses: unknown[] = [];
  let nothingSent = false;
  try {
    let output: string;
    if (a.kind === 'conflict-push') {
      output = await publishConflict(a);
    } else if (a.kind === 'run-push') {
      output = await publishRunBranch(a);
    } else if (a.kind === 'suggest-agent') {
      // Accepting creates an ordinary agent in the team: local work, nothing leaves the machine, so no `assertExternalWrite` here.
      if (!suggestionHooks.accept) throw new Error(t('main.suggestions.noHook'));
      output = suggestionHooks.accept(a).output;
    } else if (a.kind === 'release-git') {
      const r = await runRelease(originOf(a), a.unit);
      output = r.output;
      nothingSent = r.sent === false;
    } else if (isVcsAction(a)) {
      // A group runs in order from where it stopped; each write is audited on its own, under the proposal that holds them.
      const all = a.commands ?? [a.command as VcsCommand];
      const outputs: string[] = [];
      for (let i = a.done ?? 0; i < all.length; i++) {
        const c = all[i];
        let response: unknown;
        outputs.push(
          await audited(originOf(a), { kind: auditKindOf(c), target: `${c.method} ${c.endpoint}`, via: c.via, fields: auditFieldsOf(c) }, async (meta) => {
            const out = await runVcs(c, meta);
            response = meta.response;
            return out;
          }),
        );
        responses.push(response);
        if (all.length > 1) update(id, (x) => ({ ...x, done: i + 1 }));
      }
      output = outputs.join('\n');
    } else if (a.kind === 'sync') {
      const args = ['sync', '--apply', '--issue', String(a.issue)];
      output = await audited(originOf(a), { kind: 'sync', target: `release-sync ${args.join(' ')}`, via: 'cli', fields: {} }, () => cli(args));
    } else if (a.noteId && a.proposedBody) {
      const body = a.proposedBody;
      const [cmd] = await vcsProvider().planWrite({ op: 'editIssueNote', project: issueProjectKey(), iid: a.issue, noteId: a.noteId, body });
      output = await audited(originOf(a), { kind: 'note-edit', target: `${cmd.method} ${cmd.endpoint}`, via: cmd.via, fields: { body } }, async (meta) => {
        await runVcs(cmd, meta);
        return t('main.actions.noteEdited', { note: a.noteId ?? '', issue: a.issue });
      });
    } else {
      const args = ['publish', '--publish', '--issue', String(a.issue)];
      output = await audited(originOf(a), { kind: 'publish', target: `release-sync ${args.join(' ')}`, via: 'cli', fields: {} }, () => cli(args));
    }
    const done = update(id, (x) => ({ ...x, state: 'done', finishedAt: new Date().toISOString(), output, ...(nothingSent ? { nothingSent: true } : {}) }));
    // The push pipeline takes a moment to appear; the comment draft waits for it.
    told(done, responses);
    if (done.kind === 'sync') setTimeout(() => void proposeQaComment(done).catch((e) => console.error('[actions]', e)), PIPELINE_WAIT_MS);
    if (done.kind === 'conflict-push') return await afterPublish(done);
    return done;
  } catch (e) {
    return update(id, (x) => ({ ...x, state: 'failed', finishedAt: new Date().toISOString(), output: String((e as Error).message) }));
  }
}

/** Tells `fn` after the person set a proposal aside ("not now", a refusal, a blocked plugin write). Returns the way to stop. */
export type SkipListener = (action: ReleaseAction) => void;
const skipListeners = new Set<SkipListener>();

export function onActionSkipped(fn: SkipListener): () => void {
  skipListeners.add(fn);
  return () => void skipListeners.delete(fn);
}

export async function skipAction(id: string): Promise<ReleaseAction> {
  const a = read().actions.find((x) => x.id === id);
  if (a?.kind === 'conflict-push') throw new Error(t('main.actions.pushGoes'));
  // A plugin's request or announced write is set aside only while it waits: one already answered, sent or blocked stays what it was.
  if ((a?.kind === 'plugin-ask' || a?.kind === 'plugin-write') && a.state !== 'pending') throw new Error(t('main.actions.handled'));
  // Treated outside: the worktree this app made for it goes away too.
  if (a?.kind === 'conflict' && a.resolve && !a.resolve.publishedAt) await discardConflict(id);
  // A plugin's write set aside before its deadline is blocked: it never goes out, and the list says so.
  const blocked = a?.kind === 'plugin-write' && a.state === 'pending' ? { output: t('main.plugins.write.blocked') } : {};
  const done = update(id, (x) => ({ ...x, state: 'skipped', finishedAt: new Date().toISOString(), ...blocked }));
  for (const fn of skipListeners) {
    try {
      fn(done);
    } catch (e) {
      console.error('[actions] listener', e);
    }
  }
  return done;
}

function now(): string {
  return formatTime(new Date());
}

export async function conflictTalk(id: string, question: string): Promise<ReleaseAction> {
  const a = read().actions.find((x) => x.id === id);
  if (!a || a.kind !== 'conflict') throw new Error(t('main.actions.conflictMissing', { id }));
  const u = (a.unit ?? {}) as Partial<Unit>;
  const commands = u.repo && u.src_sha && u.tgt_sha
    ? [
        `git -C ${u.repo} merge-tree --write-tree --name-only ${u.src_sha} ${u.tgt_sha}`,
        `git -C ${u.repo} merge-base ${u.src_sha} ${u.tgt_sha}`,
        cp('conflict.context.diffBranch', { repo: u.repo, sha: u.src_sha }),
        cp('conflict.context.diffMain', { repo: u.repo, sha: u.tgt_sha }),
      ].join('\n')
    : cp('conflict.context.noMirror');
  const context = [
    cp('conflict.context.issue', { issue: issueRef(a.issue), title: String(a.issueTitle), release: String(a.release), files: a.files.join(', ') || cp('conflict.context.noFiles') }),
    cp('conflict.context.commands', { commands }),
    a.resolve && !a.resolve.publishedAt ? cp('conflict.context.worktree', { worktree: a.resolve.worktree, step: conflictStep(a) }) : '',
    cp('conflict.context.unit', { unit: JSON.stringify(a.unit).slice(0, 3000) }),
  ].filter(Boolean).join('\n');
  const r = await conflictAsk(context, question, a.sessionId);
  return update(id, (x) => ({
    ...x,
    sessionId: r.sessionId,
    msgs: [...x.msgs, ...(x.msgs.length || x.sessionId ? [{ me: true, text: question, at: now() }] : []), { me: false, text: r.text, speech: r.speech, at: now(), ...(r.partial ? { partial: true } : {}) }],
  }));
}

// ---- Resolving a release conflict in the app -------------------------------------------------------------------
// Local steps (prepare, propose, choose, apply, commit, reopen, discard) only touch a throwaway worktree under the data
// dir. The one external step is the push, a separate `conflict-push` action that waits for its own "sim".

const stepLocks = new Set<string>();
const CONFLICTS = join(ATAS, 'conflicts');
const FENCE = /^```[\w-]*\r?\n([\s\S]*?)\r?\n?```\s*$/;

// Tests replace these: the clone search roots and what runs after a publish.
let cloneRootsOverride: string[] | null = null;
export const conflictHooks: {
  cloneRoots: string[];
  scheduleQaComment: (sync: ReleaseAction) => void;
} = {
  get cloneRoots() {
    return cloneRootsOverride ?? rc().cloneRoots;
  },
  set cloneRoots(roots: string[]) {
    cloneRootsOverride = roots;
  },
  scheduleQaComment: (sync) => {
    // The push pipeline takes a moment to appear; the comment draft waits for it.
    setTimeout(() => void proposeQaComment(sync).catch((e) => console.error('[actions]', e)), PIPELINE_WAIT_MS);
  },
};

// What accepting a suggestion does: the suggestions module registers it (creating the agent and recording the decision), so Actions stays the door
// and the module keeps the record. A test that approves one without the module registered gets a clear failure rather than a silent no-op.
export const suggestionHooks: { accept: ((action: ReleaseAction) => { output: string; agentId: string }) | null } = { accept: null };

function conflictOf(id: string): { a: ReleaseAction; r: ConflictResolve | null } {
  const a = read().actions.find((x) => x.id === id);
  if (!a || a.kind !== 'conflict') throw new Error(t('main.actions.conflictMissing', { id }));
  return { a, r: a.resolve ?? null };
}

function resolved(id: string): { a: ReleaseAction; r: ConflictResolve } {
  const { a, r } = conflictOf(id);
  if (!r) throw new Error(t('main.actions.notPrepared'));
  if (r.publishedAt) throw new Error(t('main.actions.alreadyPublished'));
  return { a, r };
}

function setResolve(id: string, change: (r: ConflictResolve) => ConflictResolve): ReleaseAction {
  return update(id, (x) => (x.resolve ? { ...x, resolve: change(x.resolve) } : x));
}

async function withStep<T>(id: string, label: string, fn: () => Promise<T>): Promise<T> {
  if (stepLocks.has(id)) throw new Error(t('main.actions.stepRunning'));
  stepLocks.add(id);
  if (conflictOf(id).r) setResolve(id, (r) => ({ ...r, busy: label }));
  try {
    return await fn();
  } finally {
    stepLocks.delete(id);
    try {
      setResolve(id, (r) => ({ ...r, busy: null }));
    } catch {}
  }
}

function projectOf(u: Partial<Unit>): string {
  const mirrors = rc().releaseSync?.mirrorsDir?.replace(/\/+$/, '');
  const repo = u.repo ?? '';
  return u.project_path ?? (mirrors && repo.startsWith(`${mirrors}/`) ? repo.slice(mirrors.length + 1) : repo).replace(/\.git$/, '');
}

const OPEN_STATES = new Set(['pending', 'running', 'failed']);

// Starts a resolution from an MR the card shows with conflicts, outside the post-release scan. Reads GitLab (GET only)
// and writes the same conflict action the scan would, so Preparar needs nothing but a local clone.
export async function conflictFromMr(card: Pick<Card, 'iid' | 'title' | 'stage' | 'mrPaths'>, mrRef: string): Promise<ReleaseAction> {
  const issue = Number(card.iid);
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(t('main.actions.noIssueNumber', { iid: card.iid }));
  const { project, iid } = resolveMr(mrRef, card.mrPaths);
  const ref = crRef(primaryKind(), project, iid, { full: true });
  const prov = vcsProvider();
  const [mr, repo, user] = await Promise.all([prov.getMr(project, iid), prov.getRepo(project), prov.currentUser()]);
  assertResolvable(ref, mr, { me: user.username, defaultBranch: repo.defaultBranch });
  const tgtSha = await prov.getBranchSha(project, mr.targetBranch);

  const key = `conflict:${ref}:${tgtSha}`;
  const store = read();
  const open = store.actions.filter((a) => a.kind === 'conflict' && OPEN_STATES.has(a.state) && !a.resolve?.publishedAt && (a.key === key || (a.resolve && a.mrs[0]?.ref === ref)));
  const reuse = open.find((a) => a.resolve) ?? open[0];
  if (reuse) return reuse;

  const unit: Unit = {
    issue_iid: issue,
    issue_title: card.title,
    stage: card.stage ?? '',
    mr_ref: ref,
    mr_url: mr.webUrl,
    source_branch: mr.sourceBranch,
    atras: 0,
    mine: true,
    bloqueado: false,
    status: 'CONFLITO',
    tgt_sha: tgtSha,
    conflitos: [],
    repo: '',
    src_sha: mr.sha,
    project_path: project,
    mr_iid: iid,
    target_branch: mr.targetBranch,
  };
  const action = blank({
    key,
    kind: 'conflict',
    issue,
    issueTitle: card.title,
    stage: card.stage ?? '',
    release: t('main.actions.mrInConflict'),
    mrs: [{ ref, url: mr.webUrl, branch: mr.sourceBranch, behind: 0 }],
    files: [],
    unit: unit as unknown as Record<string, unknown>,
  });
  write({ ...store, actions: [action, ...store.actions] });
  return action;
}

// Who the merge of a conflict is made as: the identity the runner's commits use, or the clone's own; never the global one, which may be another
// job's address. Asked when the merge starts, so a missing one stops the work before the person resolves anything, and again at the commit.
async function mergeIdentity(clone: string): Promise<Identity> {
  const identity = await commitIdentity(getConfig().runner.identity, clone);
  if (!identity) throw new Error(t('main.actions.noCommitIdentity'));
  return identity;
}

export async function conflictPrepare(id: string): Promise<ReleaseAction> {
  return withStep(id, t('main.actions.stepPreparing'), async () => {
    const { a, r } = conflictOf(id);
    if (r) throw new Error(t('main.actions.alreadyPrepared'));
    if (a.state !== 'pending' && a.state !== 'failed') throw new Error(t('main.actions.handled'));
    const u = (a.unit ?? {}) as Partial<Unit>;
    const iid = Number(u.mr_iid ?? /[!#](\d+)$/.exec(a.mrs[0]?.ref ?? '')?.[1]);
    const branch = u.source_branch ?? a.mrs[0]?.branch;
    const project = projectOf(u);
    if (!iid || !branch || !project) throw new Error(t('main.actions.mrDataMissing'));
    const clone = await findClone(project, conflictHooks.cloneRoots, requireVcsHost());
    if (!clone) throw new Error(t('main.actions.noClone', { project, roots: conflictHooks.cloneRoots.join(', ') }));
    const target = u.target_branch ?? 'main';
    const p = await prepareWorktree({ clone, branch, target, iid, dest: join(CONFLICTS, `${basename(clone)}-${iid}`), identity: await mergeIdentity(clone) });
    for (const f of p.files) for (const h of f.hunks) h.sensitive = secretPath(f.path);
    return update(id, (x) => ({
      ...x,
      resolve: {
        clone,
        worktree: p.worktree,
        branch,
        target,
        syncBranch: p.syncBranch,
        originSha: p.originSha,
        mainSha: p.mainSha,
        files: p.files,
        preparedAt: new Date().toISOString(),
        proposedAt: null,
        proposalSummary: null,
        appliedAt: null,
        verify: null,
        commit: null,
        pushId: null,
        publishedAt: null,
        busy: null,
      },
    }));
  });
}

function unfenced(text: string): string {
  const m = FENCE.exec(text.trim());
  return m ? `${m[1]}\n` : text;
}

export async function conflictPropose(id: string): Promise<ReleaseAction> {
  return withStep(id, t('main.actions.stepProposing'), async () => {
    const { a, r } = resolved(id);
    if (r.appliedAt) throw new Error(t('main.actions.appliedAskAgain'));
    const all = r.files.flatMap((f) => f.hunks).filter((h) => !h.sensitive);
    // after a partial proposal, asking again only fills the hunks still without one
    const missing = all.filter((h) => !h.proposal);
    const hunks = missing.length && missing.length < all.length ? missing : all;
    const p = await askProposal({
      issue: a.issue,
      title: a.issueTitle,
      mr: a.mrs[0]?.ref ?? '',
      branch: r.branch,
      worktree: r.worktree,
      hunks: hunks.map((h) => ({ id: h.id, file: h.file, ours: h.ours, base: h.base, theirs: h.theirs })),
    });
    const byId = new Map(p.items.map((i) => [i.id, i]));
    return setResolve(id, (x) => ({
      ...x,
      proposedAt: new Date().toISOString(),
      proposalSummary: p.summary,
      files: x.files.map((f) => ({
        ...f,
        hunks: f.hunks.map((h) => {
          const item = byId.get(h.id);
          if (!item && !h.sensitive && !hunks.some((x) => x.id === h.id)) return h;
          if (!item || h.sensitive) return { ...h, proposal: null, explanation: null, confidence: null, test: null, partial: false, choice: h.choice === 'proposal' ? null : h.choice };
          return { ...h, proposal: unfenced(item.resolution), explanation: item.explanation, confidence: item.confidence, test: item.test, partial: !!p.partialIds?.includes(h.id) };
        }),
      })),
    }));
  });
}

export function conflictChoose(id: string, hunkId: string, choice: HunkChoice, edited?: string): ReleaseAction {
  const { r } = resolved(id);
  if (r.appliedAt) throw new Error(t('main.actions.appliedChange'));
  if (!['proposal', 'ours', 'theirs', 'edit'].includes(choice)) throw new Error(t('main.actions.badChoice', { choice }));
  if (choice === 'edit') {
    if (typeof edited !== 'string') throw new Error(t('main.actions.noEdited'));
    if (hasMarkers(edited)) throw new Error(t('main.actions.editedMarkers'));
  }
  const all = hunkId === '*';
  if (all && choice !== 'proposal') throw new Error(t('main.actions.allOnlyProposal'));
  if (!all && !r.files.some((f) => f.hunks.some((h) => h.id === hunkId))) throw new Error(t('main.actions.hunkMissing', { id: hunkId }));
  return setResolve(id, (x) => ({
    ...x,
    files: x.files.map((f) => ({
      ...f,
      hunks: f.hunks.map((h) => {
        if (all ? h.proposal === null : h.id !== hunkId) return h;
        if (choice === 'proposal' && h.proposal === null) throw new Error(t('main.actions.hunkNoProposal'));
        return { ...h, choice, edited: choice === 'edit' ? (edited as string) : h.edited };
      }),
    })),
  }));
}

function verifyLog(r: ConflictResolve, iid: string): string {
  return join(CONFLICTS, 'logs', `${basename(r.clone)}-${iid}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
}

async function writeAndVerify(id: string, skipTests: boolean): Promise<ReleaseAction> {
  const { a, r } = resolved(id);
  if (r.appliedAt) throw new Error(t('main.actions.applied'));
  const open = r.files.flatMap((f) => f.hunks).filter((h) => !hunkReady(h)).length;
  if (open) throw new Error(t('main.actions.undecided', { count: open }));
  const u = (a.unit ?? {}) as Partial<Unit>;
  const command = verifyCommandFor(projectOf(u));
  if (!command && !skipTests) {
    throw new Error(t('main.actions.noVerify', { project: projectOf(u) }));
  }
  await applyResolutions(r.worktree, r.files);
  let verify = { command, skipped: !command, exitCode: null as number | null, tail: '', log: null as string | null, at: new Date().toISOString() };
  if (command) {
    const logFile = verifyLog(r, String(u.mr_iid ?? a.id));
    const v = await runVerify({ wt: r.worktree, clone: r.clone, command, logFile });
    verify = { ...verify, exitCode: v.exitCode, tail: v.tail, log: logFile };
  }
  return setResolve(id, (x) => ({ ...x, appliedAt: new Date().toISOString(), verify }));
}

export async function conflictApply(id: string, options: { skipTests: boolean }): Promise<ReleaseAction> {
  const done = await withStep(id, t('main.actions.stepApplying'), () => writeAndVerify(id, options.skipTests === true));
  const v = done.resolve?.verify;
  // A failing run is the user's call (a repository can have failures on main): the commit waits for conflictCommit.
  if (v && (v.skipped || v.exitCode === 0)) return conflictCommit(id);
  return done;
}

export async function conflictCommit(id: string): Promise<ReleaseAction> {
  return withStep(id, t('main.actions.stepCommitting'), async () => {
    const { a, r } = resolved(id);
    if (!r.appliedAt) throw new Error(t('main.actions.applyFirst'));
    if (r.commit) throw new Error(t('main.actions.alreadyCommitted'));
    const sha = await commitMerge(r.worktree, r.branch, r.mainSha, await mergeIdentity(r.clone));
    const push = blank({
      key: `conflict-push:${a.id}:${sha}`,
      kind: 'conflict-push',
      issue: a.issue,
      issueTitle: a.issueTitle,
      stage: a.stage,
      release: a.release,
      mrs: a.mrs,
      files: r.files.map((f) => f.path),
      retest: true,
      summary: t('main.actions.publishSummary', { ref: a.mrs[0]?.ref ?? crWord(), branch: r.branch }),
      unit: { conflictId: a.id, branch: r.branch, commit: sha },
      output: [
        // i18n-ignore: a git command line shown as it runs
        `git -C ${r.worktree} push origin HEAD:refs/heads/${r.branch}`,
        // i18n-ignore: a git command line shown as it runs
        t('main.actions.commitNote', { sha: sha.slice(0, 9), message: `Merge branch 'main' into '${r.branch}'` }),
        r.verify?.skipped ? t('main.actions.verifySkipped') : r.verify?.exitCode === 0 ? t('main.actions.verifyPassed') : t('main.actions.verifyFailed', { code: String(r.verify?.exitCode) }),
      ].join('\n'),
    });
    const s = read();
    write({ ...s, actions: [push, ...s.actions] });
    const next = setResolve(id, (x) => ({ ...x, commit: sha, pushId: push.id }));
    if (getSettings().notifications) {
      deps?.notify({
        title: t('main.actions.resolvedTitle', { issue: a.issue }),
        body: t('main.actions.resolvedBody', { ref: a.mrs[0]?.ref ?? crWord() }),
        onClick: { type: 'conflict', id: a.id },
      });
    }
    return next;
  });
}

export async function conflictReopen(id: string): Promise<ReleaseAction> {
  return withStep(id, t('main.actions.stepReopening'), async () => {
    const { r } = resolved(id);
    if (!r.appliedAt) throw new Error(t('main.actions.notApplied'));
    if (r.commit) throw new Error(t('main.actions.committedRedo'));
    await reopenResolutions(r.worktree, r.files);
    return setResolve(id, (x) => ({ ...x, appliedAt: null, verify: null }));
  });
}

async function discardConflict(id: string): Promise<ReleaseAction> {
  const { r } = conflictOf(id);
  if (!r) return conflictOf(id).a;
  if (r.publishedAt) throw new Error(t('main.actions.alreadyPublished'));
  const push = r.pushId ? read().actions.find((x) => x.id === r.pushId) : null;
  if (push?.state === 'running') throw new Error(t('main.actions.pushRunning'));
  await removeWorktree(r.clone, r.worktree, r.syncBranch, CONFLICTS);
  if (push && push.state !== 'done') update(push.id, (x) => ({ ...x, state: 'skipped', finishedAt: new Date().toISOString(), output: t('main.actions.discarded') }));
  // The conflict action stays pending: the problem is still there.
  return update(id, (x) => ({ ...x, resolve: null }));
}

export async function conflictDiscard(id: string): Promise<ReleaseAction> {
  return withStep(id, 'Descartando…', () => discardConflict(id));
}

function pushOwner(a: ReleaseAction): { conflict: ReleaseAction; r: ConflictResolve } {
  const conflictId = String((a.unit ?? {}).conflictId ?? '');
  const conflict = read().actions.find((x) => x.id === conflictId);
  if (!conflict?.resolve?.commit || conflict.resolve.pushId !== a.id) throw new Error(t('main.actions.pushOrphan'));
  return { conflict, r: conflict.resolve };
}

async function checkPublishable(a: ReleaseAction): Promise<void> {
  const { r } = pushOwner(a);
  if (r.publishedAt) throw new Error(t('main.actions.published'));
  await assertPublishable({ wt: r.worktree, branch: r.branch, originSha: r.originSha, commit: r.commit as string });
}

async function publishConflict(a: ReleaseAction): Promise<string> {
  const { r } = pushOwner(a);
  const fields = { repo: r.clone, branch: r.branch, commit: r.commit as string, mr: a.mrs[0]?.ref ?? '' };
  // i18n-ignore: a git command line shown as it runs
  return audited(originOf(a), { kind: 'push', target: `git push origin HEAD:refs/heads/${r.branch}`, via: 'git', fields }, async () => {
    // The check ran moments ago, before "running"; repeat it right at the push.
    await assertPublishable({ wt: r.worktree, branch: r.branch, originSha: r.originSha, commit: r.commit as string });
    return pushBranch(r.worktree, r.branch);
  });
}

// ---- the push of a run's branch -----------------------------------------------------------------------------------------------------------
// The runner never pushes: it proposes the push here and it waits for its own "sim" whatever the agents' autonomy. The action names a run, never a
// folder: the worktree and the branch are read from the run's file when it is approved, so a stored action cannot point the push anywhere else.

/** Proposes the push of a run's branch. A push of the same run that still waits is replaced: what goes is the branch as it is when the "sim" comes. */
export function proposeRunPush(input: { key: string; issue: number; issueTitle?: string; summary: string; detail?: string; runId: string; branch: string; notify?: { title: string; body: string } }): ReleaseAction | null {
  const store = read();
  if (store.actions.some((a) => a.key === input.key && (a.state === 'pending' || a.state === 'running' || a.state === 'done'))) return null;
  const now = new Date().toISOString();
  const replaced = store.actions.map((a) => (a.kind === 'run-push' && a.state === 'pending' && a.unit?.runId === input.runId ? { ...a, state: 'skipped' as const, finishedAt: now, output: t('main.actions.replaced') } : a));
  const action = blank({
    key: input.key,
    kind: 'run-push',
    issue: input.issue,
    issueTitle: input.issueTitle ?? '',
    summary: input.summary,
    unit: { runId: input.runId, branch: input.branch },
    // i18n-ignore: a git command line shown as it runs
    output: [input.detail, `git -C <worktree> push origin HEAD:refs/heads/${input.branch}`].filter(Boolean).join('\n\n'),
  });
  write({ ...store, actions: [action, ...replaced] });
  if (input.notify && getSettings().notifications) deps?.notify({ ...input.notify, onClick: { type: 'navigate', to: 'actions' } });
  return action;
}

/** Proposes a new agent the cycle suggested. Accepting creates the agent, so it writes nothing external: the person decides in Actions. */
export function proposeAgentSuggestion(input: { key: string; summary: string; name: string; role: string; stage: string; draft: string; evidence: string; rejectedBefore?: { at: string; changed: string[] } | null; suggestionId: string; notify?: { title: string; body: string } }): ReleaseAction | null {
  const store = read();
  // Whether the suggestion may be raised at all was decided in `buildSuggestions` (a rejection only lets it back with evidence it never saw). Here
  // only the card is deduplicated: the same proposal is not left in Actions twice while it still waits for its decision.
  if (store.actions.some((a) => a.kind === 'suggest-agent' && a.key === input.key && (a.state === 'pending' || a.state === 'running'))) return null;
  const lines = [
    t('main.suggestions.card.name', { value: input.name }),
    t('main.suggestions.card.role', { value: input.role }),
    t('main.suggestions.card.stage', { value: input.stage }),
    t('main.suggestions.card.permission', { value: t('ui.team.permission.read') }),
    '',
    t('main.suggestions.card.draft'),
    input.draft,
    '',
    t('main.suggestions.card.evidence'),
    input.evidence,
    ...(input.rejectedBefore ? ['', t('main.suggestions.card.rejectedBefore', { at: input.rejectedBefore.at, changed: input.rejectedBefore.changed.join(', ') || t('main.suggestions.card.rejectedNoChange') })] : []),
  ];
  const action = blank({
    key: input.key,
    kind: 'suggest-agent',
    // The suggestion is not about one issue: the card reads neither a number nor a title.
    issue: 0,
    issueTitle: '',
    stage: input.stage,
    summary: input.summary,
    unit: { purpose: 'suggest-agent', suggestionId: input.suggestionId, name: input.name, role: input.role, stage: input.stage, prompt: input.draft, evidence: input.evidence, rejectedBefore: input.rejectedBefore ?? null },
    output: lines.join('\n'),
  });
  write({ ...store, actions: [action, ...store.actions] });
  if (input.notify && getSettings().notifications) deps?.notify({ ...input.notify, onClick: { type: 'navigate', to: 'actions' } });
  return action;
}

async function publishRunBranch(a: ReleaseAction): Promise<string> {
  const runId = String((a.unit ?? {}).runId ?? '');
  const run = runStore().get(runId);
  if (!run || run.branch !== (a.unit ?? {}).branch) throw new Error(t('main.actions.pushNoRun', { run: runId.slice(0, 40) }));
  if (!existsSync(run.worktree)) throw new Error(t('main.conflictGit.worktreeGone'));
  const here = (await git(run.worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  if (here !== run.branch) throw new Error(t('main.actions.pushWrongBranch', { branch: run.branch, here }));
  // What the agents did is committed by the app after each stage: a change that is not committed would silently stay behind.
  if ((await git(run.worktree, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()) throw new Error(t('main.conflictGit.dirty'));
  const fields = { repo: run.repo, branch: run.branch, run: run.id, head: (await git(run.worktree, ['rev-parse', 'HEAD'])).stdout.trim() };
  // i18n-ignore: a git command line shown as it runs
  return audited(originOf(a), { kind: 'push', target: `git push origin HEAD:refs/heads/${run.branch}`, via: 'git', fields }, () => pushBranch(run.worktree, run.branch));
}

// ---- the steps of a release -----------------------------------------------------------------------------------------------------------------
// A release action names an operation and a version (shared/release.ts), never a folder or a command: the run it belongs to says which repository, the
// configuration says the identity, and the repository's own release script decides whether a version may be cut. What leaves the machine (the push of the
// branch, the push of a tag) only ever waits here for its own "sim"; the other steps run when a person says "sim" too, or by themselves when the agent that asked
// is autonomous (`runReleaseAuto`). All of them are audited and refused in a test workspace.

/** Proposes one step of a release. A proposal with the same key that waits, runs or ran is not made twice. */
export function proposeRelease(input: { key: string; issue: number; issueTitle?: string; summary: string; detail?: string; unit: ReleaseUnit; group?: string; notify?: { title: string; body: string } }): ReleaseAction | null {
  const unit = parseReleaseUnit(input.unit);
  if (!unit.runId) throw new Error(t('main.release.noRun', { version: unit.version }));
  const store = read();
  if (store.actions.some((a) => a.key === input.key && (a.state === 'pending' || a.state === 'running' || a.state === 'done'))) return null;
  const action = blank({
    key: input.key,
    kind: 'release-git',
    issue: input.issue,
    issueTitle: input.issueTitle ?? '',
    summary: input.summary,
    unit: { ...unit },
    ...(input.group ? { group: input.group } : {}),
    output: [input.detail, releaseCommandLine(unit)].filter(Boolean).join('\n\n'),
  });
  write({ ...store, actions: [action, ...store.actions] });
  if (input.notify && getSettings().notifications) deps?.notify({ ...input.notify, onClick: { type: 'navigate', to: 'actions' } });
  return action;
}

interface ReleaseContext {
  run: NonNullable<ReturnType<ReturnType<typeof runStore>['get']>>;
  clone: string;
  project: string | null;
}

/**
 * The run and the repository a release action works on, read from the run (the unit holds neither a path nor a repository). A run that ended still counts: its
 * pushes may wait for a "sim" after its stages are over; only a cancelled run stops them.
 */
async function releaseContextOf(unit: ReleaseUnit): Promise<ReleaseContext> {
  const run = unit.runId ? runStore().get(unit.runId) : null;
  if (!run || run.subject?.kind !== 'release' || run.subject.version !== unit.version || run.status === 'cancelled') throw new Error(t('main.release.noRun', { version: unit.version }));
  const repo = rc().repos.find((r) => r.id === run.repo);
  if (!repo) throw new Error(t('main.release.noRepo', { repo: run.repo }));
  let clone: string | null = existsSync(join(repo.path, '.git')) ? repo.path : null;
  if (!clone && repo.projectPath && rc().vcsHost) clone = await findClone(repo.projectPath, rc().cloneRoots, rc().vcsHost as string);
  if (!clone) throw new Error(t('main.release.noRepo', { repo: run.repo }));
  return { run, clone, project: repo.projectPath };
}

// No checks at all is accepted only when the pull request was last touched more than this long ago: a push whose checks have not started yet shows no checks, and a repository
// that requires them would be merged unchecked. (Whether the repository requires checks is not asked: that needs rights the app does not have.)
const CHECKS_START_MS = 10 * 60_000;

// A time the host did not give, or gave in a form that is none, counts as just now (running), and so does one in the future (the host's clock is ahead of ours): the doubt goes to the
// side that waits. The limits: a CI queue that takes longer than this to start still shows "none" and passes, and a clock far behind ours would let a fresh push through.
const justPushed = (updatedAt: string | null): boolean => {
  const at = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isNaN(at) || Date.now() - at < CHECKS_START_MS;
};

const checksOf = (ci: { status: string } | null, updatedAt: string | null = null): ReleasePr['checks'] => (!ci ? (justPushed(updatedAt) ? 'running' : 'none') : ci.status === 'success' || ci.status === 'skipped' ? 'success' : ci.status === 'failed' || ci.status === 'canceled' ? 'failing' : 'running');

/** One release step, run and audited. The unit is read again from what was stored: nothing in it is believed until it passes `parseReleaseUnit` here. */
async function runRelease(origin: AuditOrigin, raw: unknown): Promise<{ output: string; sent?: boolean }> {
  const unit = parseReleaseUnit(raw);
  const { run, clone, project } = await releaseContextOf(unit);
  const id = getConfig().runner.identity;
  const identity = { name: id.name.trim(), email: id.email.trim() };
  if (!identity.name || !identity.email) throw new Error(t('main.release.noIdentity'));
  let plannedHead: string | undefined;
  // A merge brings in only the head the person approved with the plan: a pull request that was not in it, or that moved since, is not merged by the agent.
  if (unit.op === 'merge-pr') {
    const planned = run.subject?.planned?.[String(unit.pr)];
    if (!planned || !sameSha(planned, unit.head as string)) throw new Error(t('main.release.notPlanned', { pr: unit.pr as number }));
    plannedHead = planned;
  }
  // The only maintainer's "sim" stands for the review of their own pull request: only a person's "sim" (an agent's autonomy never gives one), and only when the workspace
  // says so. The account is the one the app uses on the host, read now.
  const soleMaintainer = unit.op === 'merge-pr' && origin.kind !== 'auto' && soleMaintainerOf(getConfig().runner) ? (await vcsProvider().currentUser()).username : undefined;
  const push = isReleasePush(unit.op);
  const fields: Record<string, string> = { op: unit.op, version: unit.version, run: run.id, repo: run.repo, ...(unit.pr !== undefined ? { pr: String(unit.pr) } : {}) };
  let sent: boolean | undefined;
  const output = await audited(origin, { kind: push ? 'push' : 'release', target: releaseCommandLine(unit), via: push ? 'git' : 'release.sh', fields }, async () => {
    const r = await runReleaseOp(unit, {
      clone,
      // The steps run in a worktree of their own next to the run's: the person's checkout is never touched. Derived from the run, never from the unit.
      worktree: join(dirname(run.worktree), `release-${unit.version}-steps`),
      identity,
      ...(plannedHead ? { planned: plannedHead } : {}),
      ...(soleMaintainer ? { soleMaintainer } : {}),
      pr: async (n) => {
        const mr = await vcsProvider().getMr(project ?? issueProjectKey(), n, { approvals: true });
        // What a merge may rely on: an approval bound to the head by a member of the project where the host can say (GitHub), the host's plain approval where it cannot.
        return { state: mr.state, draft: mr.draft, sourceBranch: mr.sourceBranch, targetBranch: mr.targetBranch, sha: mr.sha, approved: mr.approvals?.onHead ?? mr.approvals?.approved === true, author: mr.author, changesRequested: (mr.approvals?.changesRequestedBy.length ?? 0) > 0, checks: checksOf(mr.ci, mr.updatedAt), fork: mr.fromFork !== false };
      },
    });
    fields.before = r.before ?? '';
    fields.after = r.after ?? '';
    if (r.tag) fields.tag = r.tag;
    // the audit log says a push that sent nothing for what it was, not as a write that changed the host
    if (r.sent !== undefined) fields.sent = String(r.sent);
    sent = r.sent;
    return r.output;
  });
  return { output, ...(sent !== undefined ? { sent } : {}) };
}

/**
 * One release step an agent's autonomy lets go out without a "sim". A push, a beta and a stable are refused here whatever the caller says: they only ever wait for a person;
 * so does a merge when the person is the only maintainer.
 */
export async function runReleaseAuto(w: { issue: number; key: string; summary: string; by: string }, raw: unknown): Promise<string> {
  const unit = parseReleaseUnit(raw);
  if (alwaysWaits(unit.op)) throw new Error(t('main.release.autoPush'));
  if (releaseWaits(unit.op, soleMaintainerOf(getConfig().runner))) throw new Error(t('main.release.autoSoleMerge'));
  return (await runRelease({ issue: w.issue, actionId: `auto:${w.key}`, kind: 'auto', key: w.key, summary: w.summary, by: w.by }, unit)).output;
}

async function previewReleaseAction(a: ReleaseAction): Promise<string> {
  const unit = parseReleaseUnit(a.unit);
  const { clone } = await releaseContextOf(unit);
  return previewRelease(unit, clone);
}

// After a successful push: clean up, close the conflict and hand the QA comment to its own "sim".
async function afterPublish(push: ReleaseAction): Promise<ReleaseAction> {
  const conflictId = String((push.unit ?? {}).conflictId ?? '');
  const { a, r } = conflictOf(conflictId);
  const notes: string[] = [];
  if (r) {
    try {
      await removeWorktree(r.clone, r.worktree, r.syncBranch, CONFLICTS);
    } catch (e) {
      notes.push(t('main.actions.worktreeLeft', { reason: (e as Error).message }));
    }
  }
  update(conflictId, (x) => ({
    ...x,
    state: 'done',
    finishedAt: new Date().toISOString(),
    output: t('main.actions.resolvedPublished', { branch: r?.branch ?? '' }),
    resolve: x.resolve ? { ...x.resolve, publishedAt: new Date().toISOString() } : x.resolve,
  }));
  if (getSettings().notifications) {
    deps?.notify({ title: t('main.actions.publishedTitle', { issue: a.issue }), body: t('main.actions.publishedBody', { ref: a.mrs[0]?.ref ?? crWord(), branch: r?.branch ?? '' }), onClick: { type: 'navigate', to: 'actions' } });
  }
  conflictHooks.scheduleQaComment({
    ...a,
    retest: true,
    output: t('main.actions.handResolved', { count: r?.files.length ?? 0, branch: r?.branch ?? '', files: a.files.join(', ') }),
  });
  return notes.length ? update(push.id, (x) => ({ ...x, output: [x.output, ...notes].join('\n') })) : read().actions.find((x) => x.id === push.id) ?? push;
}

// ---- what a plugin asks for, and the write it is allowed --------------------------------------------------------------------------------
// A plugin never writes by itself and never widens what it reaches by itself. What it was not allowed becomes a request here, answered by the person on
// the computer with how far the "yes" reaches; what it was allowed goes out through `audited`, like every other write. A test workspace widens nothing:
// no request is opened there and no write goes out. The destination is the neutral one the plugin declared, an outbox of the workspace, never a
// named third-party service.

/** What a plugin's request carries: enough to make the call again once the person answers, even after the app was closed. */
export interface PluginAskUnit {
  plugin: string;
  /** The plugin's name, as the list shows it. */
  name: string;
  need: 'network' | 'write';
  /** For a write: whether it can be undone. An irreversible write may only be allowed always. */
  reversible: boolean;
  /** The run whose event called the plugin; null outside a run. */
  runId: string | null;
  event: string;
  stage: string | null;
  /** For the network: the destinations it declared. For a write: where it goes and what it would write. */
  hosts: string[];
  to: string | null;
  text: string;
  /** For a JavaScript plugin's write: the request it asked the app to make, carried out once the person allows it. */
  request?: { id: string; path?: string; query?: Record<string, string>; body?: string; contentType?: string; target: string; reach?: string };
}

/** Opens the request of a plugin. Refused in a test workspace (it widens nothing); null when the same request already waits. */
export function proposePluginAsk(input: { key: string; issue: number; issueTitle?: string; summary: string; unit: PluginAskUnit; notify?: { title: string; body: string } }): ReleaseAction | null {
  assertExternalWrite(t('main.plugins.ask.title'));
  const store = read();
  if (store.actions.some((a) => a.key === input.key && (a.state === 'pending' || a.state === 'running'))) return null;
  const u = input.unit;
  const what = u.need === 'network' ? t('main.plugins.ask.network', { plugin: u.name, hosts: u.hosts.join(', ') }) : t(u.reversible ? 'main.plugins.ask.write' : 'main.plugins.ask.writeIrreversible', { plugin: u.name, to: u.to ?? '' });
  const action = blank({ key: input.key, kind: 'plugin-ask', issue: input.issue, issueTitle: input.issueTitle ?? '', summary: input.summary, unit: { ...u }, output: [what, u.need === 'write' && u.text ? `\n${u.text}` : ''].filter(Boolean).join('\n') });
  write({ ...store, actions: [action, ...store.actions] });
  if (input.notify && getSettings().notifications) deps?.notify({ ...input.notify, onClick: { type: 'navigate', to: 'actions' } });
  return action;
}

/** The plugin requests still waiting for the person, newest first. */
export function pendingPluginAsks(): ReleaseAction[] {
  return read().actions.filter((a) => a.kind === 'plugin-ask' && a.state === 'pending');
}

/** Closes a request with the person's answer: allowed (done) or refused (set aside), with the words the list keeps. */
export function settlePluginAsk(id: string, allowed: boolean, words: string): ReleaseAction {
  const a = read().actions.find((x) => x.id === id);
  if (!a || a.kind !== 'plugin-ask') throw new Error(t('main.actions.missing', { id }));
  if (a.state !== 'pending') throw new Error(t('main.actions.handled'));
  return update(id, (x) => ({ ...x, state: allowed ? 'done' : 'skipped', finishedAt: new Date().toISOString(), output: [x.output, '', words].filter((l) => l !== null).join('\n') }));
}

/** The write of a plugin as an action keeps it. */
export interface PluginWriteInput {
  plugin: string;
  to: string;
  text: string;
}

const pluginWriteOf = (a: ReleaseAction): PluginWriteInput => ({ plugin: String((a.unit ?? {}).plugin ?? ''), to: String((a.unit ?? {}).to ?? ''), text: String((a.unit ?? {}).text ?? '') });

/** Where a plugin's neutral destination lands: an outbox of this workspace, one file per destination the plugin declared. */
export const pluginOutboxFile = (plugin: string, to: string): string => join(ATAS, 'plugins-out', plugin, `${to}.md`);

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The executor of a plugin's write: appends what the plugin returned to its outbox, through `audited`, so the line in the audit log is about what was
 * written and a test workspace refuses before anything is. The names come from a validated declaration and are checked again here.
 */
async function writePluginOutbox(origin: AuditOrigin, input: PluginWriteInput): Promise<string> {
  if (!PLAIN.test(input.plugin) || !PLAIN.test(input.to)) throw new Error(t('main.plugins.write.badDestination'));
  const file = pluginOutboxFile(input.plugin, input.to);
  return audited(origin, { kind: 'plugin-write', target: `${input.plugin}/${input.to}`, via: 'plugin', fields: { plugin: input.plugin, to: input.to, bytes: String(Buffer.byteLength(input.text)) } }, async () => {
    mkdirSync(dirname(file), { recursive: true });
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    writeFileSync(file, `${before}${before ? '\n' : ''}## ${new Date().toISOString()} · #${origin.issue}\n\n${input.text.trim()}\n`);
    return t('main.plugins.write.done', { plugin: input.plugin, to: input.to });
  });
}

/**
 * A plugin's write request to a service, made by the plugins service through `audited`: one line in the audit log about what was sent (never the
 * secret or the body), and a test workspace refuses before anything goes out. `origin` names the announced action or, for a write that goes out at
 * once, the plugin as who.
 */
export function auditPluginRequest(origin: AuditOrigin | { issue: number; key: string; summary: string; plugin: string }, target: string, fields: Record<string, string>, send: () => Promise<string>): Promise<string> {
  const from: AuditOrigin = 'actionId' in origin ? origin : { issue: origin.issue, actionId: `auto:${origin.key}`, kind: 'plugin-write', key: origin.key, summary: origin.summary, by: origin.plugin };
  return audited(from, { kind: 'plugin-write', target, via: 'plugin', fields }, send);
}

/** A plugin's write that goes out now (allowed and reversible): no card, the same door and the same audit log, with the plugin as who. */
export function writePluginNow(w: { issue: number; key: string; summary: string; plugin: string }, input: PluginWriteInput): Promise<string> {
  return writePluginOutbox({ issue: w.issue, actionId: `auto:${w.key}`, kind: 'plugin-write', key: w.key, summary: w.summary, by: w.plugin }, input);
}

/** Announces a plugin's allowed irreversible write: it waits in Actions until `due`, and the person may block it meanwhile. */
export function announcePluginWrite(input: { key: string; issue: number; issueTitle?: string; summary: string; runId: string | null; seconds: number; write: PluginWriteInput; request?: PluginAskUnit['request'] }): ReleaseAction | null {
  assertExternalWrite(t('main.plugins.write.title'));
  const store = read();
  if (store.actions.some((a) => a.key === input.key && (a.state === 'pending' || a.state === 'running'))) return null;
  const due = new Date(Date.now() + input.seconds * 1000).toISOString();
  const action = blank({ key: input.key, kind: 'plugin-write', issue: input.issue, issueTitle: input.issueTitle ?? '', summary: input.summary, unit: { ...input.write, runId: input.runId, due, ...(input.request ? { request: input.request } : {}) }, output: [t('main.plugins.write.to', { to: input.write.to }), '', input.write.text].join('\n') });
  write({ ...store, actions: [action, ...store.actions] });
  return action;
}

/** Sets an announced write aside without telling anyone: the plugin was switched off or its permission taken back, and `words` say so in the list. */
export function withdrawPluginWrite(id: string, words: string): ReleaseAction | null {
  const a = read().actions.find((x) => x.id === id);
  if (!a || a.kind !== 'plugin-write' || a.state !== 'pending') return null;
  return update(id, (x) => ({ ...x, state: 'skipped', finishedAt: new Date().toISOString(), output: words }));
}

/** The person goes on without answering: the requests of `runId` stay in Actions and no longer hold the run. */
export function releasePluginAsks(runId: string): void {
  const store = read();
  let changed = false;
  const actions = store.actions.map((a) => {
    if (a.kind !== 'plugin-ask' || a.state !== 'pending' || (a.unit ?? {}).runId !== runId) return a;
    changed = true;
    return { ...a, unit: { ...(a.unit ?? {}), holdsRun: false } };
  });
  if (changed) write({ ...store, actions });
}

/** The announced writes still waiting for their deadline. */
export function pendingPluginWrites(): ReleaseAction[] {
  return read().actions.filter((a) => a.kind === 'plugin-write' && a.state === 'pending');
}

/** Starts the deadline of an announced write again: after the app was closed, the person gets the whole interval before anything goes out. */
export function rearmPluginWrite(id: string, seconds: number): ReleaseAction {
  return update(id, (x) => ({ ...x, unit: { ...(x.unit ?? {}), due: new Date(Date.now() + seconds * 1000).toISOString() } }));
}

/** The deadline passed: the announced write goes out, unless the person blocked it meanwhile (then nothing happens). */
export async function sendDuePluginWrite(id: string, execute?: (a: ReleaseAction, origin: AuditOrigin) => Promise<string>): Promise<ReleaseAction | null> {
  const a = read().actions.find((x) => x.id === id);
  if (!a || a.kind !== 'plugin-write' || a.state !== 'pending') return null;
  update(id, (x) => ({ ...x, state: 'running' }));
  try {
    // A plugin's request to a service is made by the plugins service (it holds the declaration and the secret); the outbox write is this door's own.
    const output = execute ? await execute(a, originOf(a)) : await writePluginOutbox(originOf(a), pluginWriteOf(a));
    return update(id, (x) => ({ ...x, state: 'done', finishedAt: new Date().toISOString(), output }));
  } catch (e) {
    return update(id, (x) => ({ ...x, state: 'failed', finishedAt: new Date().toISOString(), output: String((e as Error).message) }));
  }
}

export function startActions(d: { notify(n: Notice): void; emit(ev: AppEvent): void }): void {
  deps = d;
  // A step interrupted by quitting the app would stay "busy" forever.
  const s = read();
  if (s.actions.some((a) => a.resolve?.busy)) write({ ...s, actions: s.actions.map((a) => (a.resolve?.busy ? { ...a, resolve: { ...a.resolve, busy: null } } : a)) });
}
