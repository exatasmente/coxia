import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry } from '../shared/auditoria';
import type { AgentDef } from '../shared/config/types';
import { resolveRemoteControl, type RemoteControlRefusal } from '../shared/remoteControl';
import { t } from '../shared/i18n';
import { isTestWorkspace } from './workspace';

// The one place that talks to the bridge of claude.ai/code (#282). The SDK's `./bridge` API is alpha, so nothing else imports it: everything goes through `BridgeApi`,
// which a test replaces with a fake. A stage's session is mirrored, never steered: the bridge is attached outbound only, so what is typed in claude.ai/code or the
// Claude app never reaches the session, and the app's paired-phone rules, sandbox and approvals stay the only way in.

/** The part of a bridge session the app uses. */
export interface BridgeHandle {
  write(message: unknown): void;
  sendResult(): void;
  close(): void;
}

/** A refusal of the bridge's own: `reason` is its word (`untrusted_device`, `session_stale_relogin`, `oauth_rejected`, `request_rejected`...). */
export interface BridgeFailure {
  terminal: boolean;
  reason: string;
}

/** The three calls of the SDK's `./bridge` the app makes; a test hands a fake. */
export interface BridgeApi {
  createCodeSession(baseUrl: string, accessToken: string, title: string, timeoutMs: number, tags?: string[]): Promise<string | BridgeFailure | null>;
  fetchRemoteCredentials(sessionId: string, baseUrl: string, accessToken: string, timeoutMs: number): Promise<{ worker_jwt: string; api_base_url: string; worker_epoch?: number } | BridgeFailure | null>;
  attachBridgeSession(opts: { sessionId: string; ingressToken: string; apiBaseUrl: string; epoch?: number; outboundOnly: boolean; onInboundMessage?: (message: unknown) => void }): Promise<BridgeHandle>;
}

/** A stage's session as seen from claude.ai/code: what the engine hands it is shown there, and closing it ends the bridge. Never throws. */
export interface SessionMirror {
  /** The id `createCodeSession` gave: what the audit line names. */
  readonly id: string;
  write(message: unknown): void;
  /** A turn ended: claude.ai/code stops showing the session as working. */
  turnEnd(): void;
  close(): void;
}

export type MirrorResult = { ok: true; mirror: SessionMirror } | { ok: false; reason: string };

const BASE_URL = 'https://api.anthropic.com';
const TIMEOUT_MS = 15_000;
/** The tag every session the app opens carries, so the person can find them in claude.ai/code. */
export const SESSION_TAG = 'coxia';

// What the engine's messages are shown there: the turns of the session and their end. Partial pieces, the system's own notices and rate limits stay in the app.
const MIRRORED = new Set(['assistant', 'user', 'result']);

const failureOf = (v: unknown): string | null => (v && typeof v === 'object' && typeof (v as BridgeFailure).reason === 'string' ? (v as BridgeFailure).reason : null);

/** The first message of every mirrored session: the page accepts what is typed and shows no refusal of its own, so the app says it before anyone tries. */
function readOnlyNotice(text: string): unknown {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    parent_tool_use_id: null,
    message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: '', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
  };
}

/** Opens a read-only session in claude.ai/code: create, fetch the worker's credential, attach outbound only, say it is read-only. Never throws: a failure is a reason. */
export async function openMirror(o: { api: BridgeApi; token: string | null; title: string; baseUrl?: string; timeoutMs?: number }): Promise<MirrorResult> {
  if (!o.token) return { ok: false, reason: 'no_credential' };
  const base = o.baseUrl ?? BASE_URL;
  const timeout = o.timeoutMs ?? TIMEOUT_MS;
  try {
    const created = await o.api.createCodeSession(base, o.token, o.title, timeout, [SESSION_TAG]);
    if (typeof created !== 'string') return { ok: false, reason: failureOf(created) ?? 'unreachable' };
    const creds = await o.api.fetchRemoteCredentials(created, base, o.token, timeout);
    if (!creds || failureOf(creds)) return { ok: false, reason: failureOf(creds) ?? 'unreachable' };
    const worker = creds as { worker_jwt: string; api_base_url: string; worker_epoch?: number };
    const handle = await o.api.attachBridgeSession({
      sessionId: created,
      ingressToken: worker.worker_jwt,
      apiBaseUrl: worker.api_base_url,
      ...(typeof worker.worker_epoch === 'number' ? { epoch: worker.worker_epoch } : {}),
      outboundOnly: true,
      // Outbound only: the bridge delivers nothing. Should it ever, the message is dropped here and never reaches the session.
      onInboundMessage: () => undefined,
    });
    let closed = false;
    const safely = (what: string, fn: () => void): void => {
      if (closed) return;
      try {
        fn();
      } catch (e) {
        console.error('[remote-control]', what, e instanceof Error ? e.message : e);
      }
    };
    const mirror: SessionMirror = {
      id: created,
      write: (message) => {
        const type = message && typeof message === 'object' ? (message as { type?: unknown }).type : null;
        if (typeof type === 'string' && MIRRORED.has(type)) safely('write', () => handle.write(message));
      },
      turnEnd: () => safely('result', () => handle.sendResult()),
      close: () => {
        safely('close', () => handle.close());
        closed = true;
      },
    };
    mirror.write(readOnlyNotice(t('main.remoteControl.readOnly')));
    mirror.turnEnd();
    return { ok: true, mirror };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : 'failed' };
  }
}

/**
 * The OAuth credential the signed-in Claude Code keeps on this computer, read when a session opens and never stored or logged by the app. Absent, unreadable or expired:
 * null, and the stage runs without the bridge.
 */
export function readClaudeToken(home: string, now = Date.now()): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8')) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } };
    const oauth = raw.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null;
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= now) return null;
    return oauth.accessToken;
  } catch {
    return null;
  }
}

/** The SDK's bridge, loaded the first time a session asks for it. */
export async function loadBridgeApi(): Promise<BridgeApi> {
  return (await import('@anthropic-ai/claude-agent-sdk/bridge')) as unknown as BridgeApi;
}

/** The audit line of a session opened with Remote Control: one per session id, written when it opens. */
export function remoteControlEntry(o: { session: string; agent: string; mode: string; run: string; issue: number; ref: string }): Omit<AuditEntry, 'at'> {
  return {
    kind: 'remote-control',
    issue: o.issue,
    target: 'claude.ai/code',
    via: 'bridge',
    fields: { session: o.session, agent: o.agent, mode: o.mode, run: o.run, ref: o.ref },
    ok: true,
    code: null,
    result: 'opened',
    origin: { actionId: '', kind: 'remote-control', key: o.session, summary: null },
    by: o.agent,
  };
}

export type RemoteControlSink = (entry: Omit<AuditEntry, 'at'>) => void;

/** What a stage asks of Remote Control: a mirror of its session, or null with the reason said (`say`) when it runs without one. */
export interface RemoteControlPort {
  open(o: { agent: AgentDef; run: { id: string; issue: number; ref: string }; title: string; say: (code: string, params: Record<string, string>) => void }): Promise<SessionMirror | null>;
}

const REFUSAL_REASON: Record<RemoteControlRefusal, string> = { 'test-workspace': 'test_workspace', paired: 'paired', persona: 'persona' };

/** The port a run's stages use. Off for an agent: nothing is loaded, read or said. */
export function createRemoteControlPort(deps: { test?: () => boolean; token: () => string | null; api: () => Promise<BridgeApi>; audit: RemoteControlSink }): RemoteControlPort {
  // The workspace's own test flag unless a test hands one: the runner itself never asks it (only its door does).
  const isTest = deps.test ?? isTestWorkspace;
  // One line per session: the same id is never audited twice, whatever asks for it.
  const audited = new Set<string>();
  return {
    async open({ agent, run, title, say }) {
      const decision = resolveRemoteControl({ agent: agent.remoteControl, test: isTest(), origin: 'stage' });
      if (decision.refusal) {
        say('runner.remoteControl.skipped', { agent: agent.id, reason: REFUSAL_REASON[decision.refusal] });
        return null;
      }
      if (decision.mode === 'off') return null;
      let api: BridgeApi;
      try {
        api = await deps.api();
      } catch (e) {
        console.error('[remote-control] the bridge could not be loaded', e instanceof Error ? e.message : e);
        say('runner.remoteControl.skipped', { agent: agent.id, reason: 'unavailable' });
        return null;
      }
      const opened = await openMirror({ api, token: deps.token(), title });
      if (!opened.ok) {
        say('runner.remoteControl.skipped', { agent: agent.id, reason: opened.reason });
        return null;
      }
      if (!audited.has(opened.mirror.id)) {
        audited.add(opened.mirror.id);
        try {
          deps.audit(remoteControlEntry({ session: opened.mirror.id, agent: agent.id, mode: decision.mode, run: run.id, issue: run.issue, ref: run.ref }));
        } catch (e) {
          console.error('[remote-control] audit', e instanceof Error ? e.message : e);
        }
      }
      say('runner.remoteControl.opened', { agent: agent.id });
      return opened.mirror;
    },
  };
}
