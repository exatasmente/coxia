import { join } from 'node:path';
import type { Through } from '../../shared/auditoria';
import { CLAUDE_SESSIONS_ASKS_EVENT } from '../../shared/claudeSessions';
import { expandHome } from '../../shared/config/paths';
import { t } from '../../shared/i18n';
import type { AppEvent } from '../../shared/types';
import { recordWrite } from '../auditoria';
import { claudeExecutable, loadClaudeSdkModule, locateSdk } from '../claudeSdk';
import { HOME } from '../env';
import { redact } from '../errorlog-core';
import type { Module } from '../module';
import { viaOf } from '../rpc';
import { isTestWorkspace } from '../workspace';
import { getConfig, onConfigChange, updateConfig } from '../workspaceConfig';
import { createClaudeAsks } from './asks-core';
import { type AuditAction, type ClaudeSessionsService, type DrivenQuery, type ServiceDeps, createClaudeSessions } from './service';
import { type RawMessage, type SdkSessions, machineSessions } from './source';

// The machine's Claude Code sessions in the desktop window (#280), opt-in and off by default. The app drives the `claude` the person installed and signed in to, through the SDK;
// it never offers a login and never reads a credential or a key file (source.ts). Three locks keep it the person's at the computer: webPolicy.ts denies every `claudeSessions:`
// channel to a paired browser, the persona's door table excludes each one, and every handler here refuses any door but the window. Its events go through the window-only emitter.
// Off, every channel but the switch refuses, so the screen has nothing to call.

export interface ModuleDeps {
  enabled(): boolean;
  setEnabled(on: boolean): void;
  onConfigChange(fn: () => void): void;
  via(): Through;
  /** The service, built once with the window-only emitter. */
  build(emit: (ev: AppEvent) => void): ClaudeSessionsService;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function makeClaudeSessionsModule(deps: ModuleDeps): Module {
  return (ctx) => {
    // Never `ctx.emit`: that one also broadcasts to every paired browser.
    const emit = ctx.emitWindow ?? ((): void => undefined);
    const service = deps.build(emit);
    let was = deps.enabled();
    deps.onConfigChange(() => {
      const now = deps.enabled();
      if (was && !now) service.shutdown();
      was = now;
    });
    const window = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
      if (deps.via() !== 'window') throw new Error(t('main.claudeSessions.windowOnly'));
      return fn(...a);
    };
    const gate = <A extends unknown[], R>(fn: (...a: A) => R) =>
      window((...a: A): R => {
        if (!deps.enabled()) throw new Error(t('main.claudeSessions.off'));
        return fn(...a);
      });

    ctx.handle('claudeSessions:enabled', window(() => deps.enabled()));
    ctx.handle('claudeSessions:set-enabled', window((on: unknown) => {
      if (on !== true && on !== false) throw new Error(t('main.claudeSessions.badToggle'));
      deps.setEnabled(on);
      return deps.enabled();
    }));
    ctx.handle('claudeSessions:list', gate(() => service.list()));
    ctx.handle('claudeSessions:read', gate((id: unknown) => service.read(text(id))));
    ctx.handle('claudeSessions:follow', gate((id: unknown) => service.follow(text(id) || null)));
    ctx.handle('claudeSessions:folders', gate(() => service.folders()));
    ctx.handle('claudeSessions:send', gate((id: unknown, body: unknown) => service.send(text(id), text(body))));
    ctx.handle('claudeSessions:asks', gate(() => service.pending()));
    ctx.handle('claudeSessions:answer', gate((id: unknown, decision: unknown) => service.answer(text(id), decision, deps.via())));
    ctx.handle('claudeSessions:stop', gate((id: unknown) => service.stop(text(id))));
    ctx.handle('claudeSessions:end', gate((id: unknown) => service.end(text(id))));
    ctx.handle('claudeSessions:start', gate((folder: unknown, body: unknown) => service.start(text(folder), text(body))));
  };
}

/** The SDK's query, loaded on first use; the stream and the interrupt wait for it. */
function sdkQuery(params: Parameters<ServiceDeps['query']>[0]): DrivenQuery {
  const ready = loadClaudeSdkModule().then((sdk) =>
    sdk.query({
      prompt: params.prompt as never,
      options: { ...params.options, settingSources: ['user', 'project', 'local'], pathToClaudeCodeExecutable: claudeExecutable() } as never,
    }),
  );
  return {
    async *[Symbol.asyncIterator]() {
      for await (const m of await ready) yield m as unknown as RawMessage;
    },
    interrupt: async () => (await ready).interrupt(),
  };
}

/** One audit line per message sent, permission answered, stop and start: the session, the door and the action; never the text of a message. */
export function auditClaudeSession(action: AuditAction, sessionId: string, fields: Record<string, string>): void {
  const through = viaOf();
  recordWrite({
    kind: 'claude-session',
    issue: 0,
    target: `claude:${sessionId}`,
    via: through,
    fields: { ...fields, action, through },
    ok: true,
    code: null,
    result: '',
    origin: { actionId: '', kind: 'claude-session', key: sessionId, summary: null },
  });
}

export const claudeSessionsModule: Module = makeClaudeSessionsModule({
  enabled: () => getConfig().claudeSessions?.enabled === true,
  setEnabled: (on) => void updateConfig((c) => ({ ...c, claudeSessions: { enabled: on } })),
  onConfigChange,
  via: viaOf,
  build: (emit) =>
    createClaudeSessions({
      source: machineSessions(async () => (await loadClaudeSdkModule()) as unknown as SdkSessions, join(HOME, '.claude', 'sessions')),
      query: sdkQuery,
      cli: () => {
        const where = locateSdk(getConfig().claudeSdk, HOME);
        return where.mode === 'missing' ? { ok: false, reason: where.reason } : { ok: true, reason: '' };
      },
      isTest: isTestWorkspace,
      folders: () => [...new Set(getConfig().projects.repos.map((r) => expandHome(r.path, HOME)).filter(Boolean))],
      redact: (s) => redact(s),
      emit,
      audit: auditClaudeSession,
      asks: createClaudeAsks({
        changed: (list) => emit({ type: 'module', name: CLAUDE_SESSIONS_ASKS_EVENT, payload: list }),
        audit: (a, decision) => auditClaudeSession('permission', a.sessionId, { tool: a.tool, decision }),
      }),
    }),
});
