import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeSdkConfig } from '../shared/config/types';
import { expandHome } from '../shared/config/paths';
import { HOME } from './env';
import { CLAUDE_BIN } from './paths';
import { getConfig } from './workspaceConfig';

// Where the Claude Agent SDK is loaded from. Installs made before the SDK became a separate download carry it inside the app (bundled);
// a public build installs it on first run into a folder of the user's (claudeSdk.path in the workspace config) and loads it from there.

export type SdkLocation = { mode: 'local'; root: string; entry: string } | { mode: 'bundled' } | { mode: 'missing'; reason: string };

export const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

export interface LocateDeps {
  exists: (path: string) => boolean;
  read: (path: string) => string;
  /** Whether this build ships the SDK. */
  bundled: boolean;
}

const defaults: LocateDeps = { exists: existsSync, read: (p) => readFileSync(p, 'utf8'), bundled: true };

function entryOf(pkg: { exports?: unknown; main?: string; module?: string }): string | null {
  const dot = typeof pkg.exports === 'object' && pkg.exports !== null ? (pkg.exports as Record<string, unknown>)['.'] : pkg.exports;
  const pick = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      return pick(o.import) ?? pick(o.default) ?? pick(o.node);
    }
    return null;
  };
  return pick(dot) ?? pkg.module ?? pkg.main ?? null;
}

/** The configured local install when it is there, else the bundled copy, else a reason. Pure over the config and the disk probes. */
export function locateSdk(cfg: ClaudeSdkConfig, home: string, deps: LocateDeps = defaults): SdkLocation {
  let reason = 'o Claude Agent SDK não está instalado: abra a configuração e instale-o';
  if (cfg.path?.trim()) {
    const root = join(expandHome(cfg.path, home), 'node_modules', SDK_PACKAGE);
    const manifest = join(root, 'package.json');
    if (deps.exists(manifest)) {
      try {
        const rel = entryOf(JSON.parse(deps.read(manifest)));
        if (rel && deps.exists(join(root, rel))) return { mode: 'local', root, entry: join(root, rel) };
        reason = `a instalação local do SDK em ${root} não tem o arquivo de entrada`;
      } catch {
        reason = `a instalação local do SDK em ${root} tem um package.json ilegível`;
      }
    } else reason = `o SDK não está em ${root}`;
  }
  return deps.bundled ? { mode: 'bundled' } : { mode: 'missing', reason };
}

type Query = typeof query;
let loaded: { key: string; module: Promise<{ query: Query }> } | null = null;

/** The SDK's `query`, from the local install when configured, else from the copy bundled with the app. */
export async function loadClaudeQuery(): Promise<Query> {
  const where = locateSdk(getConfig().claudeSdk, HOME);
  if (where.mode === 'missing') throw new Error(where.reason);
  const key = where.mode === 'local' ? where.entry : 'bundled';
  if (loaded?.key !== key) {
    loaded = { key, module: where.mode === 'local' ? import(/* @vite-ignore */ pathToFileURL(where.entry).href) : import('@anthropic-ai/claude-agent-sdk') };
  }
  try {
    return (await loaded.module).query;
  } catch (e) {
    loaded = null;
    throw e;
  }
}

/** The packaged app ships the SDK native binary unpacked next to app.asar; a local install resolves its own. */
export function claudeExecutable(): string | undefined {
  return locateSdk(getConfig().claudeSdk, HOME).mode === 'bundled' ? CLAUDE_BIN : undefined;
}
