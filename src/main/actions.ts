import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AuditEntry } from '../shared/auditoria';
import type { AppEvent, GitlabCommand, ReleaseAction } from '../shared/types';
import { conflictAsk, rewriteQaComment } from './agents';
import { recordWrite } from './auditoria';
import { getSettings } from './config';
import { ATAS, GITLAB, PLAYBOOK } from './env';
import type { Notice } from './scheduler';

const exec = promisify(execFile);
const CLI = join(PLAYBOOK, '.claude/bin/post-release-sync');
const FILE = join(ATAS, 'acoes.json');
const ISSUE_PROJECT = 1;
const QA_NOTE = /^@qa\.interno\b/;
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
    const { stdout, stderr } = await exec(CLI, args, { cwd: PLAYBOOK, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${err.stdout ?? ''}\n${err.stderr ?? err.message}`.trim());
  }
}

async function glab(args: string[]): Promise<string> {
  const { stdout } = await exec('glab', args, { env: { ...process.env, GITLAB_HOST: GITLAB }, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
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
  const token = (await exec('glab', ['config', 'get', 'token', '--host', GITLAB])).stdout.trim();
  const args = ['-sS', '-w', '\nHTTP %{http_code}', '-X', c.method, '-H', `PRIVATE-TOKEN: ${token}`];
  for (const [k, v] of Object.entries(c.fields)) args.push('--data-urlencode', `${k}=${v}`);
  args.push(`https://${GITLAB}/api/v4/${c.endpoint}`);
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
  return a.files.join('\n');
}

async function qaNote(issue: number): Promise<{ id: number; body: string } | null> {
  const notes = JSON.parse(await glab(['api', `projects/${ISSUE_PROJECT}/issues/${issue}/notes?sort=desc&order_by=created_at&per_page=100`])) as {
    id: number;
    body: string;
    system: boolean;
  }[];
  const note = notes.find((n) => !n.system && QA_NOTE.test(n.body.trim()));
  return note ? { id: note.id, body: note.body } : null;
}

// After a sync, the QA comment is a separate action: authorization does not carry over (post-release-sync skill).
async function proposeQaComment(sync: ReleaseAction): Promise<void> {
  if (/Code Review/i.test(sync.stage) && !/Code Review OK/i.test(sync.stage)) return;
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
  const a = read().actions.find((x) => x.id === id);
  if (!a) throw new Error(`ação ${id} não existe`);
  if (a.state !== 'pending' && a.state !== 'failed') throw new Error('esta ação já foi tratada');
  if (a.kind === 'conflict') throw new Error('conflito não se executa daqui: abra a call');
  update(id, (x) => ({ ...x, state: 'running' }));
  try {
    let output: string;
    if (a.kind === 'gitlab' && a.command) {
      const c = a.command;
      output = await audited(a, { kind: c.endpoint === 'graphql' ? 'graphql' : 'gitlab', target: `${c.method} ${c.endpoint}`, via: c.via, fields: c.fields }, (meta) => runGitlab(c, meta));
    } else if (a.kind === 'sync') {
      const args = ['sync', '--apply', '--issue', String(a.issue)];
      output = await audited(a, { kind: 'sync', target: `post-release-sync ${args.join(' ')}`, via: 'cli', fields: {} }, () => cli(args));
    } else if (a.noteId && a.proposedBody) {
      const file = join(tmpdir(), `qa-note-${a.issue}-${Date.now()}.md`);
      writeFileSync(file, a.proposedBody);
      const endpoint = `projects/${ISSUE_PROJECT}/issues/${a.issue}/notes/${a.noteId}`;
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
    return done;
  } catch (e) {
    return update(id, (x) => ({ ...x, state: 'failed', finishedAt: new Date().toISOString(), output: String((e as Error).message) }));
  }
}

export function skipAction(id: string): ReleaseAction {
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
    `Issue sz4#${a.issue} (${a.issueTitle}), release ${a.release}. Arquivos em conflito: ${a.files.join(', ') || 'nenhum listado'}.`,
    `Comandos para ler os dois lados (um por vez):\n${commands}`,
    `Unidade da ferramenta: ${JSON.stringify(a.unit).slice(0, 3000)}`,
  ].join('\n');
  const r = await conflictAsk(context, question, a.sessionId);
  return update(id, (x) => ({
    ...x,
    sessionId: r.sessionId,
    msgs: [...x.msgs, ...(x.msgs.length || x.sessionId ? [{ me: true, text: question, at: now() }] : []), { me: false, text: r.speech, at: now() }],
  }));
}

export function startActions(d: { notify(n: Notice): void; emit(ev: AppEvent): void }): void {
  deps = d;
}
