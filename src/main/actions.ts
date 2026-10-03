import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { AuditEntry } from '../shared/auditoria';
import { getTerms, t } from '../shared/i18n';
import { type ConflictResolve, type HunkChoice, conflictStep, hunkReady } from '../shared/conflict';
import { isStageKind } from '../shared/cycles/stages';
import type { AppEvent, Card, ReleaseAction, VcsCommand } from '../shared/types';
import { conflictAsk, conflictPropose as askProposal, issueRef, rewriteQaComment, secretPath } from './agents';
import { recordWrite } from './auditoria';
import { getSettings } from './config';
import {
  applyResolutions,
  assertPublishable,
  commitMerge,
  conflictsDir,
  findClone,
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
import { type VcsRuntime, vcsProvider, vcsRuntime } from './vcs';
import { STATUS_MUTATION } from './vcs/gitlab';
import { auditFieldsOf, auditKindOf, commandKind, validateVcsCommand } from './vcs/validate';
import { issueProjectKey, qaNoteMarker, rc, requireVcsHost } from './workspaceConfig';
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
    output: [input.detail, describe(input.command)].filter(Boolean).join('\n\n'),
  });
  write({ ...store, actions: [action, ...store.actions] });
  if (input.notify && getSettings().notifications) deps?.notify({ ...input.notify, onClick: { type: 'navigate', to: 'actions' } });
  return action;
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

async function runVcs(c: VcsCommand, meta: { code?: number } = {}): Promise<string> {
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
  if (a.kind === 'conflict-push') return a.output ?? '';
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

// Every real write goes through here: one line in auditoria.jsonl, whatever the outcome.
async function audited(a: ReleaseAction, base: AuditBase, write: (meta: { code?: number }) => Promise<string>): Promise<string> {
  assertExternalWrite(t('vcs.write.guard'));
  const meta: { code?: number } = {};
  const entry = { ...base, issue: a.issue, origin: { actionId: a.id, kind: a.kind, key: a.key, summary: a.summary } };
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

export async function approveAction(id: string): Promise<ReleaseAction> {
  assertExternalWrite(t('vcs.write.guard'));
  const a = read().actions.find((x) => x.id === id);
  if (!a) throw new Error(t('main.actions.missing', { id }));
  if (a.state !== 'pending' && a.state !== 'failed') throw new Error(t('main.actions.handled'));
  if (a.kind === 'conflict') throw new Error(tv('err.conflictOpenCall'));
  // A refusal here leaves the action as it was: nothing ran.
  if (a.kind === 'conflict-push') await checkPublishable(a);
  update(id, (x) => ({ ...x, state: 'running' }));
  try {
    let output: string;
    if (a.kind === 'conflict-push') {
      output = await publishConflict(a);
    } else if (isVcsAction(a)) {
      const c = a.command as VcsCommand;
      output = await audited(a, { kind: auditKindOf(c), target: `${c.method} ${c.endpoint}`, via: c.via, fields: auditFieldsOf(c) }, (meta) => runVcs(c, meta));
    } else if (a.kind === 'sync') {
      const args = ['sync', '--apply', '--issue', String(a.issue)];
      output = await audited(a, { kind: 'sync', target: `release-sync ${args.join(' ')}`, via: 'cli', fields: {} }, () => cli(args));
    } else if (a.noteId && a.proposedBody) {
      const body = a.proposedBody;
      const [cmd] = await vcsProvider().planWrite({ op: 'editIssueNote', project: issueProjectKey(), iid: a.issue, noteId: a.noteId, body });
      output = await audited(a, { kind: 'note-edit', target: `${cmd.method} ${cmd.endpoint}`, via: cmd.via, fields: { body } }, async (meta) => {
        await runVcs(cmd, meta);
        return t('main.actions.noteEdited', { note: a.noteId ?? '', issue: a.issue });
      });
    } else {
      const args = ['publish', '--publish', '--issue', String(a.issue)];
      output = await audited(a, { kind: 'publish', target: `release-sync ${args.join(' ')}`, via: 'cli', fields: {} }, () => cli(args));
    }
    const done = update(id, (x) => ({ ...x, state: 'done', finishedAt: new Date().toISOString(), output }));
    // The push pipeline takes a moment to appear; the comment draft waits for it.
    if (done.kind === 'sync') setTimeout(() => void proposeQaComment(done).catch((e) => console.error('[actions]', e)), PIPELINE_WAIT_MS);
    if (done.kind === 'conflict-push') return await afterPublish(done);
    return done;
  } catch (e) {
    return update(id, (x) => ({ ...x, state: 'failed', finishedAt: new Date().toISOString(), output: String((e as Error).message) }));
  }
}

export async function skipAction(id: string): Promise<ReleaseAction> {
  const a = read().actions.find((x) => x.id === id);
  if (a?.kind === 'conflict-push') throw new Error(t('main.actions.pushGoes'));
  // Treated outside: the worktree this app made for it goes away too.
  if (a?.kind === 'conflict' && a.resolve && !a.resolve.publishedAt) await discardConflict(id);
  return update(id, (x) => ({ ...x, state: 'skipped', finishedAt: new Date().toISOString() }));
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
  const ref = `${project}!${iid}`;
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

export async function conflictPrepare(id: string): Promise<ReleaseAction> {
  return withStep(id, t('main.actions.stepPreparing'), async () => {
    const { a, r } = conflictOf(id);
    if (r) throw new Error(t('main.actions.alreadyPrepared'));
    if (a.state !== 'pending' && a.state !== 'failed') throw new Error(t('main.actions.handled'));
    const u = (a.unit ?? {}) as Partial<Unit>;
    const iid = Number(u.mr_iid ?? /!(\d+)$/.exec(a.mrs[0]?.ref ?? '')?.[1]);
    const branch = u.source_branch ?? a.mrs[0]?.branch;
    const project = projectOf(u);
    if (!iid || !branch || !project) throw new Error(t('main.actions.mrDataMissing'));
    const clone = await findClone(project, conflictHooks.cloneRoots, requireVcsHost());
    if (!clone) throw new Error(t('main.actions.noClone', { project, roots: conflictHooks.cloneRoots.join(', ') }));
    const target = u.target_branch ?? 'main';
    const p = await prepareWorktree({ clone, branch, target, iid, dest: join(CONFLICTS, `${basename(clone)}-${iid}`) });
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
    const sha = await commitMerge(r.worktree, r.branch, r.mainSha);
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
  return audited(a, { kind: 'push', target: `git push origin HEAD:refs/heads/${r.branch}`, via: 'git', fields }, async () => {
    // The check ran moments ago, before "running"; repeat it right at the push.
    await assertPublishable({ wt: r.worktree, branch: r.branch, originSha: r.originSha, commit: r.commit as string });
    return pushBranch(r.worktree, r.branch);
  });
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

export function startActions(d: { notify(n: Notice): void; emit(ev: AppEvent): void }): void {
  deps = d;
  // A step interrupted by quitting the app would stay "busy" forever.
  const s = read();
  if (s.actions.some((a) => a.resolve?.busy)) write({ ...s, actions: s.actions.map((a) => (a.resolve?.busy ? { ...a, resolve: { ...a.resolve, busy: null } } : a)) });
}
