import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  ATTACHMENT_LIMITS,
  type AttachmentKind,
  type AttachmentLimits,
  type AttachmentRef,
  TEXT_MODEL_MAX,
  attachmentExt,
  cleanAttachmentName,
  detectAttachmentKind,
} from '../shared/attachments';
import { t } from '../shared/i18n';
import { ATAS } from './env';

// The person's attachments of the running workspace: <workspace>/anexos/<thread>/<id><ext>. One folder per conversation, one file per attachment.
// The id and the extension come from the app (the kind the content revealed), never from the name the person gave the file, so the name is data
// only. An agent called in a conversation is handed the id and reaches the file through the tool, never a path on the computer.
//
// Electron-free: the folder comes from ATAS (or an argument, for a test), the bytes come from the caller, and a refused file leaves nothing behind.

const ID_BYTES = 16;
const HEAD = 64 * 1024;

/** A short, random id: 16 hex characters, unique enough and safe as a file name. */
const newId = (): string => randomUUID().replace(/-/g, '').slice(0, ID_BYTES);

export interface AttachmentStoreDeps {
  /** The workspace's data folder; the live app uses ATAS, a test points it at its own temporary folder. */
  base?: string;
  limits?: () => AttachmentLimits;
}

/** What reading an attachment for the tool produced: the ref, the text when it goes to the model, the reason when it does not. */
export interface AttachmentRead {
  ref: AttachmentRef;
  text?: string;
  clipped?: boolean;
  /** The kind does not go to the model (leitura estrita): the reason, in the language of the workspace. */
  reason?: string;
}

const extOf = attachmentExt;

/** The name of the extension for a kind, so a file on disk reads its own kind back without the message. */
function kindOfExt(path: string): AttachmentKind {
  if (path.endsWith('.img')) return 'image';
  if (path.endsWith('.pdf')) return 'pdf';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.csv')) return 'csv';
  return 'text';
}

export function createAttachmentStore(deps: AttachmentStoreDeps = {}) {
  const base = (): string => join(deps.base ?? ATAS, 'anexos');
  const limits = (): AttachmentLimits => deps.limits?.() ?? ATTACHMENT_LIMITS;

  const dirOf = (thread: string): string => join(base(), safeThread(thread));

  const fileOf = (thread: string, id: string, kind: AttachmentKind): string => join(dirOf(thread), `${id}${extOf(kind)}`);

  // The id becomes a file name: only the ones the app makes get through.
  const safeId = (id: unknown): string => (typeof id === 'string' && /^[a-f0-9]{8,32}$/.test(id) ? id : '');

  function safeThread(thread: unknown): string {
    const name = typeof thread === 'string' ? thread.replace(/[^\w.-]/g, '_').slice(0, 80) : '';
    if (!name || name.startsWith('.')) throw new Error('bad-thread');
    return name;
  }

  /** The id of the file of `id` in `thread`, whatever its kind: the extension is not known to the caller. */
  function find(thread: string, id: string): { path: string; kind: AttachmentKind } | null {
    const sid = safeId(id);
    if (!sid) return null;
    const dir = dirOf(thread);
    if (!existsSync(dir)) return null;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(`${sid}.`)) continue;
      const path = join(dir, name);
      if (!statSync(path).isFile()) continue;
      return { path, kind: kindOfExt(name) };
    }
    return null;
  }

  /** How many files a message already carries for a thread: the count is the caller's (the message may add more in one go). */
  function sizeOf(thread: string): number {
    const dir = dirOf(thread);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).reduce((n, name) => (statSync(join(dir, name)).isFile() ? n + 1 : n), 0);
  }

  /**
   * Stores one file a person attached. The kind is decided by the content; a file over its limit or of a refused kind throws before anything is
   * written, so a refused attachment leaves no trace. Returns the ref the message carries.
   */
  function put(thread: string, name: unknown, bytes: Uint8Array, extra: { messageBytes?: number; count?: number } = {}): AttachmentRef {
    const lim = limits();
    const kind = detectAttachmentKind(bytes.subarray(0, HEAD));
    if (!kind) throw new Error(t('main.attachment.refused', { name: cleanAttachmentName(name), kind: t('main.attachment.kind.unknown') }));
    const max = kind === 'image' ? lim.imageBytes : lim.otherBytes;
    if (bytes.length > max) throw new Error(t('main.attachment.limit', { name: cleanAttachmentName(name), max: Math.round(max / 1024 / 1024 * 10) / 10 }));
    const used = (extra.messageBytes ?? 0) + bytes.length;
    if (used > lim.messageBytes) throw new Error(t('main.attachment.messageLimit', { max: Math.round(lim.messageBytes / 1024 / 1024) }));
    if ((extra.count ?? 0) >= lim.perMessage) throw new Error(t('main.attachment.tooMany', { max: lim.perMessage }));
    const id = newId();
    const dir = dirOf(thread);
    mkdirSync(dir, { recursive: true });
    const path = fileOf(thread, id, kind);
    writeFileSync(path, bytes, { flag: 'wx' });
    return { id, name: cleanAttachmentName(name), kind, bytes: bytes.length };
  }

  /** Deletes one attachment of a conversation; an unknown id is nothing to do. */
  function drop(thread: string, id: unknown): void {
    const found = find(thread, String(id ?? ''));
    if (found) rmSync(found.path, { force: true });
  }

  /**
   * Deletes the files a message carried, given the refs that message names. Deleting a message deletes its files from disk (the acceptance
   * criterion): what the message still names is removed, a file that is already gone is nothing to do, and a ref of another message is left alone.
   */
  function dropAll(thread: string, refs: readonly AttachmentRef[]): void {
    for (const ref of refs) drop(thread, ref?.id);
  }

  /**
   * Deletes one file the conversation holds, by name on disk, whatever kind it is and whether or not a ref still names it. The retention sweep walks
   * the folder and has no ref for what it found, so this is the door that lets it remove a file a message no longer carries. A name that is not one of
   * ours is nothing to do, so a hand-written line of the sweep can never reach outside the conversation's folder.
   */
  function dropFile(thread: string, name: unknown): void {
    const file = typeof name === 'string' ? name : '';
    if (!file || file !== basename(file) || file.startsWith('.')) return;
    const dir = dirOf(thread);
    if (!existsSync(dir)) return;
    const path = join(dir, file);
    if (existsSync(path) && statSync(path).isFile()) rmSync(path, { force: true });
  }

  /**
   * Deletes every file of a conversation and its folder: the conversation itself went. Nothing to do when it holds none; a name that cannot be a conversation's is
   * refused like in every other call here, so this never reaches outside the attachments folder.
   */
  function dropThread(thread: string): void {
    rmSync(dirOf(thread), { recursive: true, force: true });
  }

  /** The ref and the bytes of one attachment, or null when the conversation has no such file. */
  function get(thread: string, id: unknown): { ref: AttachmentRef; bytes: Uint8Array } | null {
    const found = find(thread, String(id ?? ''));
    if (!found) return null;
    const bytes = readFileSync(found.path);
    return { ref: { id: String(id), name: found.path.split('/').pop() ?? '', kind: found.kind, bytes: bytes.length }, bytes: new Uint8Array(bytes) };
  }

  /** Every ref of a conversation, newest first; used to tell a called agent which files a message carries is the message's own job. */
  function list(thread: string): AttachmentRef[] {
    const dir = dirOf(thread);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => {
        const path = join(dir, name);
        if (!statSync(path).isFile()) return null;
        const id = name.split('.')[0];
        return { id, name, kind: kindOfExt(name), bytes: statSync(path).size } satisfies AttachmentRef;
      })
      .filter((r): r is AttachmentRef => r !== null);
  }

  /**
   * What a called agent gets when it opens an attachment: an image or a text as its own kind, a PDF, JSON or CSV as the reason it does not go to
   * the model (leitura estrita). Never a path. `offset` and `limit` are lines, for text only.
   */
  function readForTool(thread: string, id: unknown, offset?: number, limit?: number): AttachmentRead | null {
    const found = find(thread, String(id ?? ''));
    if (!found) return null;
    const bytes = readFileSync(found.path);
    const ref: AttachmentRef = { id: String(id), name: found.path.split('/').pop() ?? '', kind: found.kind, bytes: bytes.length };
    if (found.kind === 'image') return { ref };
    if (found.kind === 'pdf' || found.kind === 'json' || found.kind === 'csv') {
      return { ref, reason: t('main.attachment.notToModel', { kind: t(`main.attachment.kind.${found.kind}`) }) };
    }
    const all = bytes.toString('utf8').split('\n');
    const from = Math.max(1, Number(offset) || 1);
    const take = Math.max(1, Math.min(Number(limit) || all.length, all.length));
    const slice = all.slice(from - 1, from - 1 + take);
    let text = slice.map((l, i) => `${from + i}\t${l}`).join('\n');
    let clipped = false;
    if (text.length > TEXT_MODEL_MAX) {
      text = text.slice(0, TEXT_MODEL_MAX);
      clipped = true;
    }
    if (from - 1 + take < all.length || clipped) clipped = true;
    return { ref, text: clipped ? `${text}\n${t('main.attachment.clipped', { max: TEXT_MODEL_MAX })}` : text, clipped };
  }

  /** Whether the ref of a message still exists on disk, with its size: the retention uses it to protect a file a live message names. */
  function holds(thread: string, id: unknown, bytes: number): boolean {
    const found = find(thread, String(id ?? ''));
    if (!found) return false;
    return statSync(found.path).size === bytes;
  }

  /** The number of files a conversation holds, and the folders it knows: what the retention sweep walks. */
  function threads(): string[] {
    if (!existsSync(base())) return [];
    return readdirSync(base(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  function files(thread: string): { path: string; size: number; mtimeMs: number }[] {
    const dir = dirOf(thread);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((path) => statSync(path).isFile())
      .map((path) => ({ path, size: statSync(path).size, mtimeMs: statSync(path).mtimeMs }));
  }

  return { put, drop, dropAll, dropFile, dropThread, get, list, readForTool, holds, threads, files, dirOf, safeId, sizeOf };
}

export type AttachmentStore = ReturnType<typeof createAttachmentStore>;

// The workspace's live store: one per process, over ATAS. The limits come from the configuration, so a change reaches the next upload.
// workspaceConfig is imported lazily: it pulls the whole config layer, and this module stays usable by a test with its own folder and limits.
let live: AttachmentStore | null = null;

export function attachmentStore(): AttachmentStore {
  live ??= createAttachmentStore({ limits: () => liveLimits() });
  return live;
}

function liveLimits(): AttachmentLimits {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getConfig } = require('./workspaceConfig') as { getConfig: () => { attachments?: { limits?: AttachmentLimits } } };
    return getConfig().attachments?.limits ?? ATTACHMENT_LIMITS;
  } catch {
    return ATTACHMENT_LIMITS;
  }
}

/** A digest of one file's bytes: the guard that the sweep and a test use to tell two files apart without holding the bytes. */
export const hashOf = (bytes: Uint8Array): string => createHash('sha1').update(bytes).digest('hex');
