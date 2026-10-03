import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SandboxError } from './errors';
import { isAbsolute, join, resolve } from 'node:path';

// What a sandbox sees of the repository. A worktree's `.git` is a file that points to a directory of the repository it was made from, which holds the objects, the refs and
// a `config` that may carry a token in a remote's address. The sandbox gets that directory read-only, with the `config` replaced by a copy that has only the harmless keys
// and the `hooks` folder replaced by an empty one; the pointer itself is bound read-only over itself, so nothing inside can edit, replace or remove it.

const KEEP: Record<string, readonly string[]> = {
  core: ['repositoryformatversion', 'filemode', 'bare', 'logallrefupdates', 'ignorecase', 'precomposeunicode', 'symlinks', 'autocrlf', 'eol', 'safecrlf', 'longpaths', 'sparsecheckout'],
  remote: ['url', 'fetch', 'promisor', 'partialclonefilter'],
  branch: ['remote', 'merge', 'rebase'],
  extensions: ['*'],
};

const SECTION = /^\s*\[\s*([A-Za-z][A-Za-z0-9.-]*)(?:\s+"([^"\n]*)")?\s*\]\s*(.*)$/;

/** A remote's address without the user and password in front of the host. */
export function withoutUserinfo(value: string): string {
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1');
}

/**
 * The repository's configuration with only what git needs to read it: the repository format, a few file settings, a remote's name, address (without credentials) and
 * refspec, a branch's upstream. Everything else is dropped: credentials, extra headers, helpers, hooks paths, file-system monitors, pagers, aliases, drivers and includes.
 * A list of what stays, not of what goes, so a key this code does not know is not carried over.
 */
export function sanitizeGitConfig(text: string): string {
  const out: string[] = [];
  let keep: readonly string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const section = SECTION.exec(raw);
    if (section) {
      const name = section[1].toLowerCase();
      keep = KEEP[name] ?? null;
      if (keep) out.push(section[2] !== undefined ? `[${name} "${section[2].replace(/[\\"]/g, '')}"]` : `[${name}]`);
      // A key on the same line as the header is not carried over.
      continue;
    }
    if (!keep) continue;
    const kv = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (!keep.includes('*') && !keep.includes(key)) continue;
    const value = key === 'url' ? withoutUserinfo(kv[2]) : kv[2];
    out.push(`\t${key} = ${value}`);
  }
  return `${out.join('\n')}\n`;
}

export interface GitView {
  /** [source, destination] read-only binds: the repository's directory, the cleaned config, empty hooks, the pointer, the files that run code. */
  binds: [string, string][];
}

const RUNS_CODE = ['.husky', '.githooks', '.gitattributes', '.gitmodules'];

function readPointer(dotgit: string): string | null {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'));
  return m ? m[1] : null;
}

/**
 * The binds that give a sandbox the repository of `worktree`, read-only. `tree` is the folder that will be mounted at the worktree's path (the worktree itself, or a
 * copy of it) and `workDir` is where the cleaned files are written (the stage folder, outside everything the sandbox can write).
 */
export function gitMounts(worktree: string, tree: string, workDir: string): GitView {
  const binds: [string, string][] = [];
  const dotgit = join(worktree, '.git');
  let st;
  try {
    st = lstatSync(dotgit);
  } catch {
    return { binds };
  }
  // The pointer is the app's own, made with the worktree: a link in its place is not.
  if (st.isSymbolicLink()) throw new SandboxError('hostile-link', { name: '.git' });
  const dir = join(workDir, 'git');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let common: string;
  let gitdir: string;
  if (st.isDirectory()) {
    common = dotgit;
    gitdir = dotgit;
  } else {
    const pointer = readPointer(dotgit);
    if (!pointer) return { binds };
    gitdir = isAbsolute(pointer) ? pointer : resolve(worktree, pointer);
    const commondir = join(gitdir, 'commondir');
    common = existsSync(commondir) ? resolve(gitdir, readFileSync(commondir, 'utf8').trim()) : gitdir;
  }
  // The pointer (or the folder) goes over itself, read-only, last of all inside the worktree: see bwrapArgs.
  binds.push([dotgit, dotgit]);
  if (!st.isDirectory()) binds.push([common, common]);
  if (gitdir !== common && !gitdir.startsWith(`${common}/`)) binds.push([gitdir, gitdir]);
  const config = join(common, 'config');
  if (existsSync(config)) {
    const copy = join(dir, 'config');
    writeFileSync(copy, sanitizeGitConfig(readFileSync(config, 'utf8')), { mode: 0o600 });
    binds.push([copy, config]);
  }
  const wtConfig = join(gitdir, 'config.worktree');
  if (existsSync(wtConfig)) {
    const copy = join(dir, 'config.worktree');
    writeFileSync(copy, sanitizeGitConfig(readFileSync(wtConfig, 'utf8')), { mode: 0o600 });
    binds.push([copy, wtConfig]);
  }
  const hooks = join(common, 'hooks');
  if (existsSync(hooks)) {
    const empty = join(dir, 'hooks');
    mkdirSync(empty, { recursive: true, mode: 0o700 });
    binds.push([empty, hooks]);
  }
  // What makes git or a package manager run code by itself, when the repository has it: read-only inside.
  // lstat, never exists: a link there (`.husky -> ../..`) would be followed by bwrap on both sides and bind a folder of this computer read-only into the sandbox. It is what
  // a hostile repository or an earlier stage would leave, so the sandbox is refused. Anything that is neither a plain file nor a folder is not bound.
  for (const name of RUNS_CODE) {
    const entry = join(tree, name);
    let kind;
    try {
      kind = lstatSync(entry);
    } catch {
      continue;
    }
    if (kind.isSymbolicLink()) throw new SandboxError('hostile-link', { name });
    if (kind.isFile() || kind.isDirectory()) binds.push([entry, join(worktree, name)]);
  }
  return { binds };
}
