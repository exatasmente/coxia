// "~/" paths keep a config portable between machines; everything that touches the disk expands them first.

export function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return `${home.replace(/\/+$/, '')}/${p.slice(2)}`;
  return p;
}

export function shrinkHome(p: string, home: string): string {
  const h = home.replace(/\/+$/, '');
  if (p === h) return '~';
  return p.startsWith(`${h}/`) ? `~/${p.slice(h.length + 1)}` : p;
}

/** The folder name Claude Code uses for a working directory under ~/.claude/projects ("/home/ana/projects" becomes "-home-ana-projects"). */
export function claudeProjectFolder(cwd: string): string {
  return cwd.replace(/\//g, '-');
}
