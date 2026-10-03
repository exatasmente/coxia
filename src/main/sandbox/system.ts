import { lstatSync, readlinkSync } from 'node:fs';

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
