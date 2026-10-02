import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandHome } from '../shared/config/paths';
import { ENV_NAME, SECRET_MAX_LENGTH, SECRET_REF, type SecretInfo, type SecretInput, type SecretSource, type SecretsStorageStatus } from '../shared/secrets';
import { t } from '../shared/i18n';

// The secrets store: values keyed by a secretRef, in DATA_ROOT/secrets.json (mode 0600), shared by every workspace and never exported.
//   stored   encrypted with the OS keychain (Electron safeStorage). Without a keychain it is refused, unless the user accepted the insecure file.
//   command  the value is the stdout of an executable the user already has (a key script, a password manager CLI...)
//   env      the value is an environment variable of the app
// Nothing here logs or returns a value except resolve(), and its callers hand it straight to a child process or an HTTP header.

export const SECRETS_FILE = 'secrets.json';

export class SecretError extends Error {
  constructor(
    readonly code: 'invalid' | 'missing' | 'unavailable' | 'insecure-refused' | 'command-failed',
    message: string,
  ) {
    super(message);
  }
}

export interface CryptoPort {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
  backend(): string | null;
}

export interface SecretsDeps {
  root: string;
  crypto: CryptoPort;
  env: NodeJS.ProcessEnv;
  home: string;
  now: () => Date;
  /** Runs an executable without a shell and returns its stdout. Throws when it exits non-zero. */
  run: (command: string, args: string[]) => string;
  exists: (path: string) => boolean;
}

interface Entry {
  source: SecretSource;
  /** stored + keychain: base64 of the ciphertext. */
  cipher?: string;
  /** stored + insecure file: the value itself. */
  plain?: string;
  updatedAt: string;
}

interface FileShape {
  version: 1;
  warning: string;
  insecure: { accepted: boolean; acceptedAt: string | null };
  entries: Record<string, Entry>;
}

const WARNING = 'Do not share or commit this file. Stored values are encrypted with the OS keychain; any value marked "plain" is readable by anyone who can read this file (mode 0600 only).'; // i18n-ignore: written into the secrets file for whoever opens it

const emptyFile = (): FileShape => ({ version: 1, warning: WARNING, insecure: { accepted: false, acceptedAt: null }, entries: {} });

export interface SecretsStore {
  list(): SecretInfo[];
  has(ref: string): boolean;
  storage(): SecretsStorageStatus;
  acceptInsecureStorage(): void;
  set(input: SecretInput): SecretInfo;
  remove(ref: string): void;
  /** The value. Throws SecretError('missing') when the ref is not configured or its source gave nothing. */
  resolve(ref: string): string;
  /** Like resolve but never throws and never returns the value: for health checks and previews. */
  check(ref: string): { ok: boolean; reason: string | null };
  forget(ref?: string): void;
}

function assertRef(ref: string): void {
  if (!SECRET_REF.test(ref)) throw new SecretError('invalid', t('main.secrets.badRef', { ref }));
}

export function createSecretsStore(deps: SecretsDeps): SecretsStore {
  const file = join(deps.root, SECRETS_FILE);
  // Command results stay in memory for the life of the process: a key script is slow and the value does not change under us.
  const cache = new Map<string, string>();

  function read(): FileShape {
    try {
      if (!existsSync(file)) return emptyFile();
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileShape>;
      return { ...emptyFile(), ...raw, insecure: { ...emptyFile().insecure, ...raw.insecure }, entries: { ...raw.entries } };
    } catch {
      throw new SecretError('unavailable', t('main.secrets.unreadable'));
    }
  }

  function write(data: FileShape): void {
    mkdirSync(deps.root, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    chmodSync(file, 0o600);
  }

  const storageStatus = (data: FileShape): SecretsStorageStatus => {
    const secure = deps.crypto.available();
    return { secure, backend: deps.crypto.backend(), insecureAccepted: data.insecure.accepted, canStore: secure || data.insecure.accepted };
  };

  function available(e: Entry): boolean {
    if (e.source.type === 'env') return !!deps.env[e.source.name];
    if (e.source.type === 'command') return deps.exists(expandHome(e.source.command, deps.home));
    try {
      return !!valueOfStored(e);
    } catch {
      return false;
    }
  }

  function valueOfStored(e: Entry): string {
    if (e.cipher !== undefined) {
      if (!deps.crypto.available()) throw new SecretError('unavailable', t('main.secrets.noKeychainDecrypt'));
      return deps.crypto.decrypt(Buffer.from(e.cipher, 'base64'));
    }
    return e.plain ?? '';
  }

  function info(ref: string, e: Entry): SecretInfo {
    const detail = e.source.type === 'command' ? [e.source.command, ...e.source.args].join(' ') : e.source.type === 'env' ? e.source.name : '';
    return { ref, source: e.source.type, detail, updatedAt: e.updatedAt, available: available(e) };
  }

  function fromCommand(source: Extract<SecretSource, { type: 'command' }>): string {
    let out: string;
    try {
      out = deps.run(expandHome(source.command, deps.home), source.args);
    } catch (e) {
      const code = (e as { status?: number; code?: string }).status ?? (e as { code?: string }).code ?? 'error';
      throw new SecretError('command-failed', t('main.secrets.commandFailed', { code: String(code) }));
    }
    return out.trim();
  }

  function resolve(ref: string): string {
    assertRef(ref);
    const hit = cache.get(ref);
    if (hit) return hit;
    const e = read().entries[ref];
    if (!e) throw new SecretError('missing', t('main.secrets.notConfigured', { ref }));
    let value: string;
    if (e.source.type === 'stored') value = valueOfStored(e);
    else if (e.source.type === 'env') value = (deps.env[e.source.name] ?? '').trim();
    else value = fromCommand(e.source);
    if (!value) throw new SecretError('missing', t('main.secrets.empty', { ref, why: e.source.type === 'env' ? t('main.secrets.envNotSet', { name: e.source.name }) : e.source.type }));
    if (e.source.type === 'command') cache.set(ref, value);
    return value;
  }

  return {
    list: () => Object.entries(read().entries).map(([ref, e]) => info(ref, e)).sort((a, b) => a.ref.localeCompare(b.ref)),
    has: (ref) => ref in read().entries,
    storage: () => storageStatus(read()),

    acceptInsecureStorage() {
      const data = read();
      data.insecure = { accepted: true, acceptedAt: deps.now().toISOString() };
      write(data);
    },

    set(input) {
      assertRef(input.ref);
      const data = read();
      const at = deps.now().toISOString();
      let entry: Entry;
      if (input.source === 'stored') {
        if (!input.value || input.value.length > SECRET_MAX_LENGTH) throw new SecretError('invalid', t('main.secrets.badValue'));
        const status = storageStatus(data);
        if (!status.canStore) throw new SecretError('insecure-refused', t('main.secrets.noKeychain'));
        entry = status.secure ? { source: { type: 'stored' }, cipher: deps.crypto.encrypt(input.value).toString('base64'), updatedAt: at } : { source: { type: 'stored' }, plain: input.value, updatedAt: at };
      } else if (input.source === 'command') {
        if (!input.command.trim() || /[\0\n\r]/.test(input.command)) throw new SecretError('invalid', t('main.secrets.badCommand'));
        entry = { source: { type: 'command', command: input.command.trim(), args: (input.args ?? []).map(String) }, updatedAt: at };
      } else {
        if (!ENV_NAME.test(input.name)) throw new SecretError('invalid', t('main.secrets.badEnvName', { name: input.name }));
        entry = { source: { type: 'env', name: input.name }, updatedAt: at };
      }
      data.entries[input.ref] = entry;
      write(data);
      cache.delete(input.ref);
      return info(input.ref, entry);
    },

    remove(ref) {
      assertRef(ref);
      const data = read();
      delete data.entries[ref];
      write(data);
      cache.delete(ref);
    },

    resolve,

    check(ref) {
      try {
        resolve(ref);
        return { ok: true, reason: null };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },

    forget(ref) {
      if (ref) cache.delete(ref);
      else cache.clear();
    },
  };
}
