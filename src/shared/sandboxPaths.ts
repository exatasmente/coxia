// What the folders a sandbox may read can be called. Pure, so the configuration check, the editor and the sandbox itself ask the same thing; the facts that need the
// machine (the data folder, the home folder) are checked where the sandbox is built.

/** Names that hold keys, tokens or settings with them: a folder or file with one of them in its path is never made visible to a sandbox. */
const SECRET_LOOKING =
  /(^|\/)(\.ssh|\.gnupg|\.gpg|\.aws|\.azure|\.config|\.docker|\.kube|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.claude(?:\.json)?|\.env(?:\.[^/]*)?|\.mozilla|\.password-store|keyrings?|id_[a-z0-9]+(?:\.pub)?)(\/|$)|secret|credential|token|passw/i;

// Places of the system that are not a toolchain: the kernel's views, devices, runtime sockets, the container daemon's state, temporary files.
const SYSTEM_PLACES = /^\/(proc|sys|dev|run|var|tmp)(\/|$)/;

export const MAX_READ_ONLY_PATHS = 20;

/** Why `path` cannot be a read-only folder of a sandbox, or null. */
export function readOnlyPathProblem(path: string): 'empty' | 'relative' | 'root' | 'home' | 'dots' | 'secret' | 'control' | null {
  if (!path.trim()) return 'empty';
  if (/[\0\n\r]/.test(path)) return 'control';
  const p = path.trim();
  if (p === '~' || p === '~/') return 'home';
  if (!p.startsWith('/') && !p.startsWith('~/')) return 'relative';
  if (p.split('/').includes('..')) return 'dots';
  const bare = p.replace(/\/+$/, '');
  if (bare === '') return 'root';
  if (SECRET_LOOKING.test(p) || SYSTEM_PLACES.test(bare)) return 'secret';
  return null;
}

/** A host name as the registry switch takes it: letters, digits, dots and hyphens, at least one dot, no scheme, port, path or wildcard. */
export const isRegistryHost = (host: string): boolean => host.length <= 253 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host);

export const MAX_REGISTRY_HOSTS = 20;

/** The ranges of the sandbox limits, for the check and the editor: [min, max]. */
export const SANDBOX_LIMIT_RANGES = {
  commandMs: [5_000, 3_600_000],
  stageMs: [60_000, 28_800_000],
  memoryMb: [512, 65_536],
  processes: [16, 4096],
  fileMb: [1, 8192],
  copyMb: [64, 65_536],
} as const satisfies Record<string, readonly [number, number]>;
