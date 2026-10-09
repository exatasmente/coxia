import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { Module } from '../module';
import type { McpStateView } from '../../shared/mcpState';
import { MCP_DATA_DIR_ENV, mergeMcpFile, serverEntryText, stateServerEntry } from './entry';
import { HOME, WORKSPACE_ID } from './env';
import { getConfig, updateConfig } from './workspaceConfig';
import { expandHome, shrinkHome } from '../../shared/config/paths';
import { t } from '../../shared/i18n';

// The Settings door of the local state server: the opt-in per workspace, the setup entry shown once it is on, and the one merge write into a
// project folder's .mcp.json — the person's action, confirmed in the dialog (the file is never touched on opt-out, and a same-name entry with a
// different program is refused, not replaced).

/** Where the state server is spawned from on this install: `out/main` of the app's own folder. */
const cliPath = (): string => join(app.getAppPath(), 'out', 'main', 'mcp-state.js');

/** A project folder the entry may be written into, as the workspace names them (roots first, then the repos). */
function targets(): { path: string; exists: boolean }[] {
  const config = getConfig();
  const folders = [...config.projects.roots, ...config.projects.repos.map((r: { path: string }) => r.path)].map((p) => expandHome(p, HOME));
  return [...new Set(folders.filter(Boolean))]
    .filter((p) => existsSync(p))
    .map((p) => ({ path: shrinkHome(p, HOME), exists: existsSync(join(p, '.mcp.json')) }));
}

export function view(): McpStateView {
  const config = getConfig();
  // A packaged install keeps out/main inside the app's own archive, where plain node cannot load code from: no entry is offered, with the reason.
  const runnable = existsSync(cliPath());
  return {
    enabled: config.mcpState?.enabled === true,
    workspaceId: WORKSPACE_ID,
    available: runnable,
    entry:
      config.mcpState?.enabled === true && runnable
        ? serverEntryText(stateServerEntry({ workspaceId: WORKSPACE_ID, cliPath: cliPath(), dataRootOverride: process.env[MCP_DATA_DIR_ENV] ?? null }))
        : null,
    path: runnable ? shrinkHome(cliPath(), HOME) : null,
    targets: targets(),
  };
}

export const mcpStateModule: Module = (ctx) => {
  ctx.handle('mcpstate:get', (): McpStateView => view());
  ctx.handle('mcpstate:set-enabled', (enabled: unknown): McpStateView => {
    if (enabled !== true && enabled !== false) throw new Error(t('main.mcpstate.badToggle'));
    updateConfig((c) => ({ ...c, mcpState: { enabled: enabled === true } }));
    return view();
  });
  ctx.handle('mcpstate:write-entry', (target: unknown): { status: 'written' | 'same'; file: string } => {
    const view_ = view();
    if (!view_.entry || !view_.available) throw new Error(t('main.mcpstate.unavailable'));
    // Only a folder the view offers is written into; the entry derived from the workspace id is the thing being written.
    const known = targets().find((t) => t.path === target);
    if (!known) throw new Error(t('main.mcpstate.badTarget', { path: shrinkHome(String(target).slice(0, 80), HOME) }));
    const file = join(expandHome(target, HOME), '.mcp.json');
    const result = mergeMcpFile(
      (f) => {
        try {
          return readFileSync(f, 'utf8');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw e;
        }
      },
      file,
      stateServerEntry({ workspaceId: WORKSPACE_ID, cliPath: cliPath(), dataRootOverride: process.env[MCP_DATA_DIR_ENV] ?? null }),
    );
    if (!result.ok) throw new Error(t('main.mcpstate.mergeConflict'));
    if (result.status === 'written') {
      mkdirSync(join(file, '..'), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, `${result.text}\n`);
      renameSync(tmp, file);
    }
    return { status: result.status, file: shrinkHome(file, HOME) };
  });
};
