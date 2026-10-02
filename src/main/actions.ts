import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { AuditEntry } from '../shared/auditoria';
import { type ConflictResolve, type HunkChoice, conflictStep, hunkReady } from '../shared/conflict';
import { isStageKind } from '../shared/cycles/stages';
import type { AppEvent, Card, GitlabCommand, ReleaseAction } from '../shared/types';
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
import { assertResolvable, resolveMr, type MrRead } from './conflictFromMr';
import { hasMarkers } from './conflictHunks';
import { verifyCommandFor } from './conflictVerify';
import { cycle } from './cyclePrompts';
import { ATAS } from './env';
import type { Notice } from './scheduler';
import { assertExternalWrite } from './workspace';
import { issueProjectRef, qaNoteMarker, rc, requireVcsHost, vcsCliEnv } from './workspaceConfig';

const exec = promisify(execFile);
const FILE = join(ATAS, 'acoes.json');
const PIPELINE_WAIT_MS = 30_000;
// The only GraphQL write the app may propose: a work item status change (authorized by the user on 2026-10-02).
export const STATUS_MUTATION =
  /^mutation \{ workItemUpdate\(input: \{ id: "gid:\/\/gitlab\/WorkItem\/\d+", statusWidget: \{ status: "gid:\/\/gitlab\/WorkItems::Statuses::Custom::Status\/\d+" \} \}\) \{ errors \} \}$/;

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
  if (i < 0) throw new Error(`ação ${id} não existe`);
  s.actions[i] = change(s.actions[i]);
  write(s);
  return s.actions[i];
}

async function cli(args: string[]): Promise<string> {
  try {
    const sync = rc().releaseSync;
    if (!sync) throw new Error('A ferramenta de sincronização de release não está configurada neste workspace.');
    const { stdout, stderr } = await exec(sync.command, args, { cwd: sync.cwd, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${err.stdout ?? ''}\n${err.stderr ?? err.message}`.trim());
  }
}

async function glab(args: string[]): Promise<string> {
  const { stdout } = await exec('glab', args, { env: vcsCliEnv(), timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
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

function describe(c: GitlabCommand): string {
  const fields = Object.entries(c.fields).map(([k, v]) => `  ${k} = ${v.length > 300 ? `${v.slice(0, 300)}… (${v.length} caracteres)` : v}`);
  return [`${c.method} ${c.endpoint}  (via ${c.via})`, ...fields].join('\n');
}

export function validateGitlabCommand(command: GitlabCommand): void {
  if (command.endpoint === 'graphql') {
    const keys = Object.keys(command.fields);
    if (command.via !== 'glab' || command.method !== 'POST' || keys.length !== 1 || !STATUS_MUTATION.test(command.fields.query ?? '')) {
      throw new Error('GraphQL só para a mudança de status do work item (workItemUpdate com statusWidget)');
    }
  } else if (!/^projects\/[\w%.-]+\/[\w/?=&%.-]+$/.test(command.endpoint) || /\.\.|%2e/i.test(command.endpoint)) {
    throw new Error(`endpoint inválido: ${command.endpoint}`);
  }
}

/**
 * Any module proposes a GitLab write here. Nothing runs until the user says "seguir" and confirms in the Actions
 * screen. `key` deduplicates: the same proposal is not created (nor notified) twice.
 */
export function proposeGitlabAction(input: {
  key: string;
  issue: number;
  issueTitle?: string;
  stage?: string;
  summary: string;
  detail?: string;
  command: GitlabCommand;
  notify?: { title: string; body: string };
}): ReleaseAction | null {
  validateGitlabCommand(input.command);
  const store = read();
  if (store.actions.some((a) => a.key === input.key && (a.state === 'pending' || a.state === 'running' || a.state === 'done'))) return null;
  const action = blank({
    key: input.key,
    kind: 'gitlab',
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

async function runGitlab(c: GitlabCommand, meta: { code?: number } = {}): Promise<string> {
  if (c.via === 'glab') {
    const args = ['api', '--method', c.method, c.endpoint];
    const files: string[] = [];
    for (const [k, v] of Object.entries(c.fields)) {
      if (v.length > 200 || v.includes('\n')) {
        const file = join(tmpdir(), `gitlab-field-${Date.now()}-${files.length}.txt`);
        writeFileSync(file, v);
        files.push(file);
        args.push('-F', `${k}=@${file}`);
      } else args.push('-f', `${k}=${v}`);
    }
    try {
      const out = await glab(args);
      // GraphQL answers 200 even when the mutation fails; the errors come in the body.
      if (c.endpoint === 'graphql') {
        const body = JSON.parse(out) as { errors?: unknown[]; data?: { workItemUpdate?: { errors?: string[] } } };
        const errors = [...(body.errors ?? []), ...(body.data?.workItemUpdate?.errors ?? [])];
        if (errors.length) throw new Error(`GitLab recusou: ${JSON.stringify(errors).slice(0, 500)}`);
      }
      return out.slice(0, 2000);
    } finally {
      for (const f of files) unlinkSync(f);
    }
  }
  // curl path: array fields such as reviewer_ids[] are rejected by glab (it sends a JSON body).
  const host = requireVcsHost();
  const token = (await exec('glab', ['config', 'get', 'token', '--host', host])).stdout.trim();
  const args = ['-sS', '-w', '\nHTTP %{http_code}', '-X', c.method, '-H', `PRIVATE-TOKEN: ${token}`];
  for (const [k, v] of Object.entries(c.fields)) args.push('--data-urlencode', `${k}=${v}`);
  args.push(`https://${host}/api/v4/${c.endpoint}`);
  const { stdout } = await exec('curl', args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  const code = /HTTP (\d+)\s*$/.exec(stdout)?.[1];
  if (code) meta.code = Number(code);
  if (!code || Number(code) >= 400) throw new Error(`GitLab respondeu ${code ?? '?'}: ${stdout.slice(0, 500)}`);
  return stdout.slice(0, 2000);
}

export function listActions(): ReleaseAction[] {
  return read().actions;
}

export async function detectRelease(manual: boolean): Promise<string> {
  if (detecting) return 'Já estou conferindo a release.';
  if (!rc().releaseSync) return 'A ferramenta de sincronização de release não está configurada neste workspace.';
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
        title: `Conflito na #${a.issue} ao sincronizar com a main`,
        body: `${a.mrs[0].ref}: ${a.files.length} arquivo(s) em conflito. Vamos conversar sobre a resolução antes do ajuste?`,
        onClick: { type: 'conflict', id: a.id },
      });
    }
    const syncs = fresh.filter((x) => x.kind === 'sync');
    if (syncs.length) {
      notify?.({
        title: `Release ${name ?? 'nova'}: ${syncs.length} atividade(s) para sincronizar`,
        body: `${syncs.map((a) => `#${a.issue}`).join(', ')} estão atrás da main. Seguir com a sincronização?`,
        onClick: { type: 'navigate', to: 'actions' },
      });
    }
    if (!fresh.length && manual) {
      notify?.({ title: 'Sincronização pós-release', body: 'Nada novo para sincronizar.', onClick: { type: 'navigate', to: 'actions' } });
    }
    return fresh.length ? `${fresh.length} ação(ões) nova(s).` : 'Nada novo para sincronizar.';
  } finally {
    detecting = false;
  }
}

export async function previewAction(id: string): Promise<string> {
  const a = read().actions.find((x) => x.id === id);
  if (!a) throw new Error(`ação ${id} não existe`);
  if (a.kind === 'gitlab' && a.command) return describe(a.command);
  if (a.kind === 'sync') return cli(['sync', '--issue', String(a.issue)]);
  if (a.kind === 'qa-comment') return a.proposedBody ?? cli(['publish', '--dump', '--issue', String(a.issue)]);
  if (a.kind === 'conflict-push') return a.output ?? '';
  return a.files.join('\n');
}

async function qaNote(issue: number): Promise<{ id: number; body: string } | null> {
  const notes = JSON.parse(await glab(['api', `projects/${issueProjectRef()}/issues/${issue}/notes?sort=desc&order_by=created_at&per_page=100`])) as {
    id: number;
    body: string;
    system: boolean;
  }[];
  const marker = qaNoteMarker();
  const note = marker ? notes.find((n) => !n.system && marker.test(n.body.trim())) : undefined;
  return note ? { id: note.id, body: note.body } : null;
}

// After a sync, the QA comment is a separate action: authorization does not carry over (post-release-sync skill).
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
    action = blank({ ...base, output: 'A issue não tem comentário do QA: a ferramenta publica o comentário dela, com marcador.' });
  }
  const s = read();
  write({ ...s, actions: [action, ...s.actions] });
  if (getSettings().notifications) {
    deps?.notify({
      title: `#${sync.issue} sincronizada. Atualizar o comentário do QA?`,
      body: note ? 'O agente preparou a nova versão do comentário de pipelines. Revise e confirme.' : 'A ferramenta vai publicar o comentário de sincronização. Revise e confirme.',
      onClick: { type: 'navigate', to: 'actions' },
    });
  }
}

type AuditBase = Pick<AuditEntry, 'kind' | 'target' | 'via' | 'fields'>;

// Every real write goes through here: one line in auditoria.jsonl, whatever the outcome.
async function audited(a: ReleaseAction, base: AuditBase, write: (meta: { code?: number }) => Promise<string>): Promise<string> {
  assertExternalWrite('escrever no GitLab, enviar branch ou publicar comentário');
  const meta: { code?: number } = {};
  const entry = { ...base, issue: a.issue, origin: { actionId: a.id, kind: a.kind, key: a.key, summary: a.summary } };
  try {
    const out = await write(meta);
    recordWrite({ ...entry, ok: true, code: meta.code ?? null, result: out });
    return out;
  } catch (e) {
    const message = String((e as Error).message);
    const code = meta.code ?? Number(/(?:respondeu|HTTP(?: error)?:?)\s*(\d{3})/i.exec(message)?.[1] ?? NaN);
    recordWrite({ ...entry, ok: false, code: Number.isNaN(code) ? null : code, result: message });
    throw e;
  }
}

export async function approveAction(id: string): Promise<ReleaseAction> {
  assertExternalWrite('escrever no GitLab, enviar branch ou publicar comentário');
  const a = read().actions.find((x) => x.id === id);
  if (!a) throw new Error(`ação ${id} não existe`);
  if (a.state !== 'pending' && a.state !== 'failed') throw new Error('esta ação já foi tratada');
  if (a.kind === 'conflict') throw new Error('o conflito se resolve na tela dele: abra a call');
  // A refusal here leaves the action as it was: nothing ran.
  if (a.kind === 'conflict-push') await checkPublishable(a);
  update(id, (x) => ({ ...x, state: 'running' }));
  try {
    let output: string;
    if (a.kind === 'conflict-push') {
      output = await publishConflict(a);
    } else if (a.kind === 'gitlab' && a.command) {
      const c = a.command;
      output = await audited(a, { kind: c.endpoint === 'graphql' ? 'graphql' : 'gitlab', target: `${c.method} ${c.endpoint}`, via: c.via, fields: c.fields }, (meta) => runGitlab(c, meta));
    } else if (a.kind === 'sync') {
      const args = ['sync', '--apply', '--issue', String(a.issue)];
      output = await audited(a, { kind: 'sync', target: `post-release-sync ${args.join(' ')}`, via: 'cli', fields: {} }, () => cli(args));
    } else if (a.noteId && a.proposedBody) {
      const file = join(tmpdir(), `qa-note-${a.issue}-${Date.now()}.md`);
      writeFileSync(file, a.proposedBody);
      const endpoint = `projects/${issueProjectRef()}/issues/${a.issue}/notes/${a.noteId}`;
      const body = a.proposedBody;
      try {
        output = await audited(a, { kind: 'note-edit', target: `PUT ${endpoint}`, via: 'glab', fields: { body } }, async () => {
          await glab(['api', '--method', 'PUT', endpoint, '-F', `body=@${file}`]);
          return `Comentário ${a.noteId} da #${a.issue} editado.`;
        });
      } finally {
        unlinkSync(file);
      }
    } else {
      const args = ['publish', '--publish', '--issue', String(a.issue)];
      output = await audited(a, { kind: 'publish', target: `post-release-sync ${args.join(' ')}`, via: 'cli', fields: {} }, () => cli(args));
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
  if (a?.kind === 'conflict-push') throw new Error('o envio some ao descartar o conflito: use Descartar na tela dele');
  // Treated outside: the worktree this app made for it goes away too.
  if (a?.kind === 'conflict' && a.resolve && !a.resolve.publishedAt) await discardConflict(id);
  return update(id, (x) => ({ ...x, state: 'skipped', finishedAt: new Date().toISOString() }));
}

function now(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export async function conflictTalk(id: string, question: string): Promise<ReleaseAction> {
  const a = read().actions.find((x) => x.id === id);
  if (!a || a.kind !== 'conflict') throw new Error(`conflito ${id} não existe`);
  const u = (a.unit ?? {}) as Partial<Unit>;
  const commands = u.repo && u.src_sha && u.tgt_sha
    ? [
        `git -C ${u.repo} merge-tree --write-tree --name-only ${u.src_sha} ${u.tgt_sha}`,
        `git -C ${u.repo} merge-base ${u.src_sha} ${u.tgt_sha}`,
        `git -C ${u.repo} diff <merge-base> ${u.src_sha} -- <arquivo>   (o que a branch mudou)`,
        `git -C ${u.repo} diff <merge-base> ${u.tgt_sha} -- <arquivo>   (o que a main mudou)`,
      ].join('\n')
    : 'Sem dados do mirror: use o GitLab.';
  const context = [
    `Issue ${issueRef(a.issue)} (${a.issueTitle}), release ${a.release}. Arquivos em conflito: ${a.files.join(', ') || 'nenhum listado'}.`,
    `Comandos para ler os dois lados (um por vez):\n${commands}`,
    a.resolve && !a.resolve.publishedAt ? `Worktree de resolução já preparada (com os marcadores nos arquivos): ${a.resolve.worktree}. Passo atual: ${conflictStep(a)}.` : '',
    `Unidade da ferramenta: ${JSON.stringify(a.unit).slice(0, 3000)}`,
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
  // GET only: the GitLab reads that conflict:fromMr makes.
  gitlabGet: (endpoint: string) => Promise<unknown>;
} = {
  get cloneRoots() {
    return cloneRootsOverride ?? rc().cloneRoots;
  },
  set cloneRoots(roots: string[]) {
    cloneRootsOverride = roots;
  },
  gitlabGet: async (endpoint) => JSON.parse(await glab(['api', endpoint])),
  scheduleQaComment: (sync) => {
    // The push pipeline takes a moment to appear; the comment draft waits for it.
    setTimeout(() => void proposeQaComment(sync).catch((e) => console.error('[actions]', e)), PIPELINE_WAIT_MS);
  },
};

function conflictOf(id: string): { a: ReleaseAction; r: ConflictResolve | null } {
  const a = read().actions.find((x) => x.id === id);
  if (!a || a.kind !== 'conflict') throw new Error(`conflito ${id} não existe`);
  return { a, r: a.resolve ?? null };
}

function resolved(id: string): { a: ReleaseAction; r: ConflictResolve } {
  const { a, r } = conflictOf(id);
  if (!r) throw new Error('o conflito ainda não foi preparado');
  if (r.publishedAt) throw new Error('este conflito já foi publicado');
  return { a, r };
}

function setResolve(id: string, change: (r: ConflictResolve) => ConflictResolve): ReleaseAction {
  return update(id, (x) => (x.resolve ? { ...x, resolve: change(x.resolve) } : x));
}

async function withStep<T>(id: string, label: string, fn: () => Promise<T>): Promise<T> {
  if (stepLocks.has(id)) throw new Error('este conflito já tem um passo em andamento');
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
  return u.project_path ?? (u.repo ?? '').replace(/^.*\/post-release-sync\//, '').replace(/\.git$/, '');
}

const OPEN_STATES = new Set(['pending', 'running', 'failed']);

// Starts a resolution from an MR the card shows with conflicts, outside the post-release scan. Reads GitLab (GET only)
// and writes the same conflict action the scan would, so Preparar needs nothing but a local clone.
export async function conflictFromMr(card: Pick<Card, 'iid' | 'title' | 'stage' | 'mrPaths'>, mrRef: string): Promise<ReleaseAction> {
  const issue = Number(card.iid);
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`atividade sem número de issue: ${card.iid}`);
  const { project, iid } = resolveMr(mrRef, card.mrPaths);
  const ref = `${project}!${iid}`;
  const enc = encodeURIComponent(project);
  const get = conflictHooks.gitlabGet;
  const [mr, proj, user] = (await Promise.all([get(`projects/${enc}/merge_requests/${iid}`), get(`projects/${enc}`), get('user')])) as [MrRead, { default_branch: string }, { username: string }];
  assertResolvable(ref, mr, { me: user.username, defaultBranch: proj.default_branch });
  const target = (await get(`projects/${enc}/repository/branches/${encodeURIComponent(mr.target_branch)}`)) as { commit: { id: string } };
  const tgtSha = target.commit.id;

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
    mr_url: mr.web_url,
    source_branch: mr.source_branch,
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
    target_branch: mr.target_branch,
  };
  const action = blank({
    key,
    kind: 'conflict',
    issue,
    issueTitle: card.title,
    stage: card.stage ?? '',
    release: 'MR em conflito com a main',
    mrs: [{ ref, url: mr.web_url, branch: mr.source_branch, behind: 0 }],
    files: [],
    unit: unit as unknown as Record<string, unknown>,
  });
  write({ ...store, actions: [action, ...store.actions] });
  return action;
}

export async function conflictPrepare(id: string): Promise<ReleaseAction> {
  return withStep(id, 'Preparando a worktree…', async () => {
    const { a, r } = conflictOf(id);
    if (r) throw new Error('o conflito já está preparado');
    if (a.state !== 'pending' && a.state !== 'failed') throw new Error('esta ação já foi tratada');
    const u = (a.unit ?? {}) as Partial<Unit>;
    const iid = Number(u.mr_iid ?? /!(\d+)$/.exec(a.mrs[0]?.ref ?? '')?.[1]);
    const branch = u.source_branch ?? a.mrs[0]?.branch;
    const project = projectOf(u);
    if (!iid || !branch || !project) throw new Error('faltam dados do MR na ação (projeto, número ou branch)');
    const clone = await findClone(project, conflictHooks.cloneRoots, requireVcsHost());
    if (!clone) throw new Error(`não achei um clone local de ${project} em ${conflictHooks.cloneRoots.join(', ')} (o remote origin precisa apontar para ele)`);
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
  return withStep(id, 'O agente está propondo a resolução…', async () => {
    const { a, r } = resolved(id);
    if (r.appliedAt) throw new Error('já aplicado: reabra a resolução para pedir outra proposta');
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
  if (r.appliedAt) throw new Error('já aplicado: reabra a resolução para mudar');
  if (!['proposal', 'ours', 'theirs', 'edit'].includes(choice)) throw new Error(`escolha inválida: ${choice}`);
  if (choice === 'edit') {
    if (typeof edited !== 'string') throw new Error('falta o texto editado');
    if (hasMarkers(edited)) throw new Error('o texto editado tem marcador de conflito (<<<<<<< ou >>>>>>>)');
  }
  const all = hunkId === '*';
  if (all && choice !== 'proposal') throw new Error('“todos” só vale para a proposta');
  if (!all && !r.files.some((f) => f.hunks.some((h) => h.id === hunkId))) throw new Error(`trecho ${hunkId} não existe`);
  return setResolve(id, (x) => ({
    ...x,
    files: x.files.map((f) => ({
      ...f,
      hunks: f.hunks.map((h) => {
        if (all ? h.proposal === null : h.id !== hunkId) return h;
        if (choice === 'proposal' && h.proposal === null) throw new Error('este trecho não tem proposta');
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
  if (r.appliedAt) throw new Error('já aplicado');
  const open = r.files.flatMap((f) => f.hunks).filter((h) => !hunkReady(h)).length;
  if (open) throw new Error(`falta decidir ${open} trecho(s)`);
  const u = (a.unit ?? {}) as Partial<Unit>;
  const command = verifyCommandFor(projectOf(u));
  if (!command && !skipTests) {
    throw new Error(`Não há comando de verificação configurado para ${projectOf(u)} (Configurações › Verificação de conflitos). Configure um ou confirme “seguir sem testes”.`);
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
  const done = await withStep(id, 'Aplicando e verificando…', () => writeAndVerify(id, options.skipTests === true));
  const v = done.resolve?.verify;
  // A failing run is the user's call (hub-whatsapp has failures on main): the commit waits for conflictCommit.
  if (v && (v.skipped || v.exitCode === 0)) return conflictCommit(id);
  return done;
}

export async function conflictCommit(id: string): Promise<ReleaseAction> {
  return withStep(id, 'Commitando o merge…', async () => {
    const { a, r } = resolved(id);
    if (!r.appliedAt) throw new Error('aplique a resolução antes de commitar');
    if (r.commit) throw new Error('o merge já foi commitado');
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
      summary: `Publicar a resolução do conflito do ${a.mrs[0]?.ref ?? 'MR'} em ${r.branch}`,
      unit: { conflictId: a.id, branch: r.branch, commit: sha },
      output: [
        `git -C ${r.worktree} push origin HEAD:refs/heads/${r.branch}`,
        `Commit ${sha.slice(0, 9)}: ${`Merge branch 'main' into '${r.branch}'`}. Só fast-forward, sem force; antes de enviar, a branch é buscada de novo e o envio é recusado se ela mudou.`,
        r.verify?.skipped ? 'Sem testes (você confirmou).' : r.verify?.exitCode === 0 ? 'Verificação passou.' : `Verificação terminou com código ${r.verify?.exitCode}: você decidiu seguir.`,
      ].join('\n'),
    });
    const s = read();
    write({ ...s, actions: [push, ...s.actions] });
    const next = setResolve(id, (x) => ({ ...x, commit: sha, pushId: push.id }));
    if (getSettings().notifications) {
      deps?.notify({
        title: `#${a.issue}: conflito resolvido, aguardando o seu “sim” para publicar`,
        body: `${a.mrs[0]?.ref ?? 'MR'}: merge commitado e verificado na worktree local. Nada foi enviado ainda.`,
        onClick: { type: 'conflict', id: a.id },
      });
    }
    return next;
  });
}

export async function conflictReopen(id: string): Promise<ReleaseAction> {
  return withStep(id, 'Reabrindo os conflitos…', async () => {
    const { r } = resolved(id);
    if (!r.appliedAt) throw new Error('a resolução ainda não foi aplicada');
    if (r.commit) throw new Error('o merge já foi commitado: descarte e prepare de novo para refazer');
    await reopenResolutions(r.worktree, r.files);
    return setResolve(id, (x) => ({ ...x, appliedAt: null, verify: null }));
  });
}

async function discardConflict(id: string): Promise<ReleaseAction> {
  const { r } = conflictOf(id);
  if (!r) return conflictOf(id).a;
  if (r.publishedAt) throw new Error('este conflito já foi publicado');
  const push = r.pushId ? read().actions.find((x) => x.id === r.pushId) : null;
  if (push?.state === 'running') throw new Error('o envio está em andamento: espere terminar');
  await removeWorktree(r.clone, r.worktree, r.syncBranch, CONFLICTS);
  if (push && push.state !== 'done') update(push.id, (x) => ({ ...x, state: 'skipped', finishedAt: new Date().toISOString(), output: 'Descartado: a worktree foi removida.' }));
  // The conflict action stays pending: the problem is still there.
  return update(id, (x) => ({ ...x, resolve: null }));
}

export async function conflictDiscard(id: string): Promise<ReleaseAction> {
  return withStep(id, 'Descartando…', () => discardConflict(id));
}

function pushOwner(a: ReleaseAction): { conflict: ReleaseAction; r: ConflictResolve } {
  const conflictId = String((a.unit ?? {}).conflictId ?? '');
  const conflict = read().actions.find((x) => x.id === conflictId);
  if (!conflict?.resolve?.commit || conflict.resolve.pushId !== a.id) throw new Error('o conflito deste envio foi descartado ou refeito: nada a publicar');
  return { conflict, r: conflict.resolve };
}

async function checkPublishable(a: ReleaseAction): Promise<void> {
  const { r } = pushOwner(a);
  if (r.publishedAt) throw new Error('já publicado');
  await assertPublishable({ wt: r.worktree, branch: r.branch, originSha: r.originSha, commit: r.commit as string });
}

async function publishConflict(a: ReleaseAction): Promise<string> {
  const { r } = pushOwner(a);
  const fields = { repo: r.clone, branch: r.branch, commit: r.commit as string, mr: a.mrs[0]?.ref ?? '' };
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
      notes.push(`A worktree ficou para trás (${(e as Error).message}): remova com git worktree remove.`);
    }
  }
  update(conflictId, (x) => ({
    ...x,
    state: 'done',
    finishedAt: new Date().toISOString(),
    output: `Resolvido e publicado em ${r?.branch}.`,
    resolve: x.resolve ? { ...x.resolve, publishedAt: new Date().toISOString() } : x.resolve,
  }));
  if (getSettings().notifications) {
    deps?.notify({ title: `#${a.issue}: resolução publicada`, body: `${a.mrs[0]?.ref ?? 'MR'}: push feito em ${r?.branch}. O comentário do QA vem em seguida, com o seu “sim”.`, onClick: { type: 'navigate', to: 'actions' } });
  }
  conflictHooks.scheduleQaComment({
    ...a,
    retest: true,
    output: `Conflito de sincronização resolvido à mão em ${r?.files.length ?? 0} arquivo(s) e publicado em ${r?.branch}: ${a.files.join(', ')}.`,
  });
  return notes.length ? update(push.id, (x) => ({ ...x, output: [x.output, ...notes].join('\n') })) : read().actions.find((x) => x.id === push.id) ?? push;
}

export function startActions(d: { notify(n: Notice): void; emit(ev: AppEvent): void }): void {
  deps = d;
  // A step interrupted by quitting the app would stay "busy" forever.
  const s = read();
  if (s.actions.some((a) => a.resolve?.busy)) write({ ...s, actions: s.actions.map((a) => (a.resolve?.busy ? { ...a, resolve: { ...a.resolve, busy: null } } : a)) });
}
