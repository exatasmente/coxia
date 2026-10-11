import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { Module } from '../module';
import type { McpStateView } from '../../shared/mcpState';
import { MCP_DATA_DIR_ENV, mergeMcpFile, serverEntryText, stateServerEntry } from './entry';
import { ATAS, HOME, WORKSPACE_ID } from '../env';
import { getConfig, onConfigChange, updateConfig } from '../workspaceConfig';
import { personaOf } from '../../shared/config/team';
import { agentThreadId } from '../../shared/forum';
import type { WorkspaceConfig } from '../../shared/config/types';
import { personaDoor } from '../persona/door';
import { createTerminalBridge } from '../persona/terminal';
import { expandHome, shrinkHome } from '../../shared/config/paths';
import { t } from '../../shared/i18n';

// The Settings door of the local state server: the opt-in per workspace, the setup entry shown once it is on, and the one merge write into a
// project folder's .mcp.json — the person's action, confirmed in the dialog (the file is never touched on opt-out, and a same-name entry with a
// different program is refused, not replaced). The second switch (`act`) opens the terminal bridge, which runs the persona's tools for a terminal
// session through the persona's door; it needs the first, and turning the first off turns it off too. Both are the computer's: a paired browser
// and the persona's own door are refused every `mcpstate:` channel (webPolicy.ts, persona/doorTable.ts).

/** Whether the bridge should listen now: both switches on. The persona is checked at every call, so a workspace may turn this on before it has one. */
const actOn = (config: WorkspaceConfig): boolean => config.mcpState?.enabled === true && config.mcpState.act === true;

const bridge = createTerminalBridge({
  dir: ATAS,
  door: personaDoor,
  persona: () => {
    const p = personaOf(getConfig().agents.team);
    return p ? { id: p.id, thread: agentThreadId(p.id) } : null;
  },
  on: () => actOn(getConfig()),
});

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
    act: actOn(config),
    persona: personaOf(config.agents.team) !== null,
    listening: bridge.listening(),
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

/** Listens while both switches are on, and closes (removing the socket and the token) as soon as either is off. */
async function sync(): Promise<void> {
  await (actOn(getConfig()) ? bridge.start() : bridge.stop());
}

export const mcpStateModule: Module = (ctx) => {
  void sync();
  // A change from anywhere else (an import, a restore) is followed too.
  onConfigChange(() => void sync());
  ctx.handle('mcpstate:get', (): McpStateView => view());
  ctx.handle('mcpstate:set-enabled', async (enabled: unknown): Promise<McpStateView> => {
    if (enabled !== true && enabled !== false) throw new Error(t('main.mcpstate.badToggle'));
    updateConfig((c) => ({ ...c, mcpState: { enabled: enabled === true, act: enabled === true && c.mcpState?.act === true } }));
    await sync();
    return view();
  });
  ctx.handle('mcpstate:set-act', async (act: unknown): Promise<McpStateView> => {
    if (act !== true && act !== false) throw new Error(t('main.mcpstate.badToggle'));
    if (act && getConfig().mcpState?.enabled !== true) throw new Error(t('main.mcpstate.actNeedsRead'));
    updateConfig((c) => ({ ...c, mcpState: { enabled: c.mcpState?.enabled === true, act } }));
    await sync();
    return view();
  });
  ctx.handle('mcpstate:write-entry', (target: unknown): { status: 'written' | 'same'; file: string } => {
    const view_ = view();
    if (!view_.entry || !view_.available) throw new Error(t('main.mcpstate.unavailable'));
    // Only a folder the view offers is written into; the entry derived from the workspace id is the thing being written.
    const known = targets().find((t) => t.path === target);
    if (!known) throw new Error(t('main.mcpstate.badTarget', { path: shrinkHome(String(target).slice(0, 80), HOME) }));
    const file = join(expandHome(String(target), HOME), '.mcp.json');
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
