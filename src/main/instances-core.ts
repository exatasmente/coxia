import { execFile } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContractError } from '../shared/contract';
import { t } from '../shared/i18n';
import { DEFAULT_REMOTE_DATA_DIR, type InstanceDef, type InstanceInput, type InstancesFile, type InstanceVia, LOCAL_INSTANCE, type SshTarget, parseSshTarget } from '../shared/instances';
import type { SecretInfo, SecretInput } from '../shared/secrets';
import { slugify } from './workspaces-core';

// The list of instances and the plumbing of one SSH link (#211). Nothing here reaches Electron. The private key is never written in the list: only the ref of the secret that
// holds it, and the value is resolved at the moment of a connection, written to a 0600 file for the ssh child and removed as soon as the child no longer needs it.

export const INSTANCES_FILE = 'instances.json';

/** The programs the link runs; a test points them at fakes. */
export interface SshCommands {
  ssh: string;
  keyscan: string;
  keygen: string;
}
export const SYSTEM_SSH: SshCommands = { ssh: 'ssh', keyscan: 'ssh-keyscan', keygen: 'ssh-keygen' };

/** The part of the secrets store the list needs. */
export interface KeyStore {
  set(input: SecretInput): SecretInfo;
  remove(ref: string): void;
  resolve(ref: string): string;
}

const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const bad = (key: string, vars?: Record<string, string>): ContractError => new ContractError('invalid-input', t(key, vars));

const isDef = (x: unknown): boolean => {
  const o = x as Record<string, unknown> | null;
  return !!o && ['id', 'name', 'sshTarget', 'remoteDataDir', 'workspace', 'keyRef'].every((k) => typeof o[k] === 'string');
};

// An entry saved before the field existed forwarded the socket, and keeps doing so.
const viaOf = (v: unknown): InstanceVia => (v === 'server' ? 'server' : 'socket');

export function readInstances(root: string): InstancesFile {
  try {
    const raw = JSON.parse(readFileSync(join(root, INSTANCES_FILE), 'utf8')) as Partial<InstancesFile>;
    const list = Array.isArray(raw.list) ? raw.list.filter(isDef).map((d) => ({ ...(d as InstanceDef), via: viaOf((d as { via?: unknown }).via) })) : [];
    return { current: typeof raw.current === 'string' && (raw.current === LOCAL_INSTANCE || list.some((i) => i.id === raw.current)) ? raw.current : LOCAL_INSTANCE, list };
  } catch {
    return { current: LOCAL_INSTANCE, list: [] };
  }
}

function writeInstances(root: string, file: InstancesFile): void {
  mkdirSync(root, { recursive: true });
  const target = join(root, INSTANCES_FILE);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
}

export const keyRefOf = (id: string): string => `instance.${id}.ssh-key`;

export function addInstance(root: string, input: InstanceInput, keys: KeyStore): InstanceDef {
  const name = String(input?.name ?? '').trim();
  if (!name || name.length > 60) throw bad('main.instances.badName');
  if (!parseSshTarget(String(input.sshTarget ?? ''))) throw bad('main.instances.badTarget');
  const dataDir = String(input.remoteDataDir ?? '').trim() || DEFAULT_REMOTE_DATA_DIR;
  // The path is the remote half of a forwarding spec, where ':' separates the parts.
  if (!dataDir.startsWith('/') || /[:\u0000-\u001f]/.test(dataDir)) throw bad('main.instances.badDataDir');
  if (!WORKSPACE.test(String(input.workspace ?? ''))) throw bad('main.instances.badWorkspace');
  const rawVia = (input as { via?: unknown }).via;
  if (rawVia !== undefined && rawVia !== 'server' && rawVia !== 'socket') throw bad('main.instances.badVia');
  const via: InstanceVia = rawVia ?? 'server';
  const file = readInstances(root);
  if (file.list.some((i) => i.name.toLowerCase() === name.toLowerCase())) throw bad('main.instances.nameTaken', { name });
  const base = slugify(name);
  let id = base;
  for (let n = 2; id === LOCAL_INSTANCE || file.list.some((i) => i.id === id); n++) id = `${base.slice(0, 44)}-${n}`;
  const keyRef = keyRefOf(id);
  // The key goes into the secrets store first: an instance never exists without it.
  keys.set({ ...(input.key as object), ref: keyRef } as SecretInput);
  const def: InstanceDef = { id, name, sshTarget: input.sshTarget.trim(), remoteDataDir: dataDir.replace(/\/+$/, '') || '/', workspace: input.workspace, keyRef, via };
  writeInstances(root, { ...file, list: [...file.list, def] });
  return def;
}

export function removeInstance(root: string, id: string, keys: KeyStore): void {
  const file = readInstances(root);
  const found = file.list.find((i) => i.id === id);
  if (!found) throw new ContractError('not-found', t('main.instances.unknown', { id }));
  writeInstances(root, { current: file.current === id ? LOCAL_INSTANCE : file.current, list: file.list.filter((i) => i.id !== id) });
  try {
    keys.remove(found.keyRef);
  } catch {
    // The entry may be gone already; the list is what matters.
  }
}

export function selectInstance(root: string, id: string): InstancesFile {
  const file = readInstances(root);
  if (id !== LOCAL_INSTANCE && !file.list.some((i) => i.id === id)) throw new ContractError('not-found', t('main.instances.unknown', { id }));
  const next = { ...file, current: id };
  writeInstances(root, next);
  return next;
}

export const instanceById = (root: string, id: string): InstanceDef => {
  const found = readInstances(root).list.find((i) => i.id === id);
  if (!found) throw new ContractError('not-found', t('main.instances.unknown', { id }));
  return found;
};

export const knownHostsPath = (root: string): string => join(root, 'instances', 'known_hosts');

/** The path of the admin socket on the server. */
export const remoteSocketPath = (def: InstanceDef): string => `${def.remoteDataDir.replace(/\/+$/, '')}/workspaces/${def.workspace}/admin.sock`;

// A key pasted into a one-line field loses its line breaks, and ssh refuses a key without its final newline: the armor is put back.
export function normalizeKey(value: string): string {
  const text = value.replace(/\r\n?/g, '\n').trim();
  const m = /^(-----BEGIN [A-Z ]+-----)\s*([\s\S]*?)\s*(-----END [A-Z ]+-----)$/.exec(text);
  if (!m) return `${text}\n`;
  const body = (m[2] as string).replace(/\s+/g, '');
  const lines = body.match(/.{1,70}/g) ?? [];
  return `${m[1]}\n${lines.join('\n')}\n${m[3]}\n`;
}

export interface KeyFile {
  path: string;
  /** Idempotent. */
  remove(): void;
}

/** The private key as a file only its owner reads, for the ssh child. The caller removes it as soon as the child has authenticated or ended. */
export function writeKeyFile(value: string): KeyFile {
  const dir = mkdtempSync(join(tmpdir(), 'coxia-key-'));
  chmodSync(dir, 0o700);
  const path = join(dir, 'id');
  writeFileSync(path, normalizeKey(value), { mode: 0o600 });
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A short folder for the local end of the forwarding (a Unix socket path has a small limit). */
export function makeSocketDir(): { dir: string; path: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'coxia-ssh-'));
  chmodSync(dir, 0o700);
  return { dir, path: join(dir, 'a.sock'), remove: () => rmSync(dir, { recursive: true, force: true }) };
}

const hardening = (o: { knownHosts: string }): string[] => [
  '-F', '/dev/null',
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', `UserKnownHostsFile=${o.knownHosts}`,
  '-o', 'GlobalKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
];
const keyAndPort = (o: { keyFile: string }, target: SshTarget): string[] => [
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ConnectTimeout=15',
  '-i', o.keyFile,
  '-p', String(target.port),
];

/** The options of the ssh child that forwards the admin socket (`socket`): strict host key, only the key given, no user configuration, no prompt, and a dead link noticed within a minute. */
export function sshArgs(def: InstanceDef, target: SshTarget, o: { knownHosts: string; keyFile: string; localSocket: string }): string[] {
  return [
    '-N', '-T',
    ...hardening(o),
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'StreamLocalBindUnlink=yes',
    ...keyAndPort(o, target),
    '-L', `${o.localSocket}:${remoteSocketPath(def)}`,
    `${target.user}@${target.host}`,
  ];
}

/** The same hardening for `server`: no forward, a remote command whose stdin and stdout carry the protocol. ssh joins the argv with spaces for the remote shell, so the workspace regex (checked when an entry is added) is what keeps it one word. */
export function sshBridgeArgs(def: InstanceDef, target: SshTarget, o: { knownHosts: string; keyFile: string }): string[] {
  // A hand-edited file must not smuggle shell syntax into the remote command.
  if (!WORKSPACE.test(def.workspace)) throw bad('main.instances.badWorkspace');
  return [
    '-T',
    ...hardening(o),
    ...keyAndPort(o, target),
    `${target.user}@${target.host}`,
    'coxia-server', 'bridge', def.workspace,
  ];
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], input?: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: 20_000, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: err && !stderr ? err.message : String(stderr ?? '') });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

// ssh-keygen -F and ssh-keyscan name a non-default port as [host]:port.
const hostSpec = (s: SshTarget): string => (s.port === 22 ? s.host : `[${s.host}]:${s.port}`);

export async function hostKnown(cmds: SshCommands, root: string, target: SshTarget): Promise<boolean> {
  const file = knownHostsPath(root);
  if (!existsSync(file)) return false;
  return (await run(cmds.keygen, ['-F', hostSpec(target), '-f', file])).code === 0;
}

export interface ScannedKey {
  line: string;
  fingerprint: string;
}

/** What the server presents. The person compares the fingerprint with the one the server's owner gives, then trusts it. */
export async function scanHostKeys(cmds: SshCommands, target: SshTarget): Promise<ScannedKey[]> {
  const scan = await run(cmds.keyscan, ['-T', '10', '-p', String(target.port), target.host]);
  const lines = scan.stdout.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) throw new ContractError('internal', t('main.instances.scanFailed', { host: target.host }));
  const out: ScannedKey[] = [];
  for (const line of lines) {
    const fp = await run(cmds.keygen, ['-l', '-f', '-'], `${line}\n`);
    const m = /(SHA256:\S+)/.exec(fp.stdout);
    if (m) out.push({ line, fingerprint: m[1] as string });
  }
  return out;
}

/** Writes to known_hosts the keys of the server whose fingerprint the person confirmed; a server presenting none of them is refused. */
export async function trustHost(cmds: SshCommands, root: string, target: SshTarget, fingerprint: string): Promise<void> {
  const keys = (await scanHostKeys(cmds, target)).filter((k) => k.fingerprint === fingerprint);
  if (!keys.length) throw new ContractError('conflict', t('main.instances.fingerprintChanged'));
  const file = knownHostsPath(root);
  mkdirSync(join(root, 'instances'), { recursive: true });
  appendFileSync(file, `${keys.map((k) => k.line).join('\n')}\n`, { mode: 0o600 });
}
