// The bundle a workspace travels in when it moves to another machine (#309). A folder; the provisioning tool tars it. Nothing here reaches the main process, so a client can import it.

/** The version of the bundle's layout; an import refuses a newer one. */
export const MOVE_BUNDLE_FORMAT = 1;

export const MOVE_FILES = { manifest: 'manifest.json', workspace: 'workspace', registry: 'registry.json', secrets: 'secrets.json', git: 'git' } as const;

export interface MoveRepo {
  id: string;
  /** Where the clone on the new machine comes from; null when the repository cannot be cloned (the import refuses it). */
  remoteUrl: string | null;
  /** `git config user.name` in the local clone; null when unset. */
  gitName: string | null;
  gitEmail: string | null;
  /** The branches of the runs still open, bundled in `git/<id>.bundle`. */
  runBranches: string[];
}

export interface MoveManifest {
  format: number;
  coxiaVersion: string;
  contractVersion: number;
  exportedAt: string;
  workspace: { id: string; name: string };
  repos: MoveRepo[];
  secrets: {
    /** Stored secrets re-encrypted under the target key. */
    moved: string[];
    /** What stays behind: a `command` or `env` source names something of the old machine; `missing` and `unreadable` are references the store could not give. */
    notMoved: { ref: string; type: string }[];
  };
  /** The files of the bundle other than the manifest, and their size. */
  files: number;
  bytes: number;
}

/** The answer of `move:export`. */
export type MoveExportInput = { targetKey: string; out: string };
