import { lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';

// What the host has at the top of its file system that a sandbox shares: /usr and /etc read-only, and each of /bin, /sbin and /lib* as the link it is on a merged-/usr
// system (made again inside as a link) or as the folder it is on an older one (bound read-only).

const TOP = ['/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32'];

export interface SystemLayout {
  roDirs: string[];
  links: [string, string][];
}

export function systemLayout(stat: (p: string) => { link: string | null; dir: boolean } | null = realStat): SystemLayout {
  const roDirs = ['/usr', '/etc'];
  const links: [string, string][] = [];
  for (const p of TOP) {
    const s = stat(p);
    if (!s) continue;
    if (s.link !== null) links.push([p, s.link]);
    else if (s.dir) roDirs.push(p);
  }
  return { roDirs, links };
}

function realStat(p: string): { link: string | null; dir: boolean } | null {
  try {
    const s = lstatSync(p);
    return { link: s.isSymbolicLink() ? readlinkSync(p) : null, dir: s.isDirectory() };
  } catch {
    return null;
  }
}

/**
 * The read-only binds a sandbox with the computer's network needs to resolve names. `/etc/resolv.conf` is often a link to somewhere outside `/etc` (a systemd or
 * resolvconf stub under `/run`), and the file it points at must exist inside too; `/etc` alone would leave a dangling link and no resolver. What is bound is the real
 * target, read-only, at its own path and at `/etc/resolv.conf` (so a resolver reading either finds it), and nothing else of `/run` or `/var`. A machine with nothing
 * to resolve names with gets no binds: the sandbox still starts, with the network shared, and the person is told name resolution may not work.
 */
export function nameResolverBinds(exists: (p: string) => boolean = existsPath, real: (p: string) => string = realpathSync): [string, string][] {
  const out: [string, string][] = [];
  try {
    const target = real('/etc/resolv.conf');
    if (!exists(target) || target === '/etc/resolv.conf') return out;
    out.push([target, target]);
    out.push([target, '/etc/resolv.conf']);
  } catch {
    // No resolver configuration: nothing to bind, the network is still shared.
  }
  return out;
}

function existsPath(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** One name at the top of `/etc`, as the host has it: the link it is, or null for a file or a folder. */
export interface EtcEntry {
  name: string;
  link: string | null;
}

/**
 * What `/etc` holds, name by name. `bwrap` cannot make a path inside a read-only bind of `/etc`, so a sandbox that must put a file of its own there (the browser's managed
 * policy) binds the real `/etc` somewhere else and rebuilds `/etc` as a folder of links to it. A name in `except` is left out for the sandbox to make itself.
 */
export function etcEntries(except: readonly string[] = [], list: () => string[] = () => readdirSync('/etc'), stat: (p: string) => string | null = (p) => readLinkOrNull(p)): EtcEntry[] {
  const out: EtcEntry[] = [];
  try {
    for (const name of list().sort()) {
      if (except.includes(name)) continue;
      out.push({ name, link: stat(`/etc/${name}`) });
    }
  } catch {
    // No readable /etc: the caller keeps the plain read-only bind.
    return [];
  }
  return out;
}

function readLinkOrNull(p: string): string | null {
  try {
    return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : null;
  } catch {
    return null;
  }
}
