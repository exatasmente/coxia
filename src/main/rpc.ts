import { AsyncLocalStorage } from 'node:async_hooks';
import { takeContext } from '../shared/activity';
import { withActivityContext } from './activity';
import { rpcContext } from './errorlog-core';
import { logError } from './errorlog';
import { CONTRACT_VERSION, ContractError, type Hello, type Settled, errorCodeOf, contractMismatch, wireErrorOf } from '../shared/contract';
import { t } from '../shared/i18n';
import type { Through } from '../shared/auditoria';
import { openAct } from './persona/act';
import { stepUpContext, type StepUpContext } from './passkeyContext';

type Handler = (...args: never[]) => unknown;
type Binder = (channel: string, fn: Handler) => void;

// One registry for every channel: the Electron window reaches it through ipcMain, the browser through the HTTP RPC.
const table = new Map<string, Handler>();
// Channels that only make sense for one browser device (push subscriptions): the HTTP RPC passes the device id, IPC never reaches them.
const deviceTable = new Map<string, (deviceId: string, ...args: never[]) => unknown>();
let bind: Binder | null = null;

type Via = 'ipc' | 'web' | 'persona' | 'admin';

// Which door a call came through, for a handler that must say who answered (a held step is answered from the window, from a paired browser or by the persona). It travels with
// the call, across the awaits of the handler, and is 'ipc' when no call is running. 'persona' holds only while the persona's act is open: work its handler leaves running is
// not the persona's. Nothing outside this file reads it; `viaOf()` is the one name, and a test fails for a second reader.
const origin = new AsyncLocalStorage<Via>();
export const callOrigin = (): Via => {
  const via = origin.getStore() ?? 'ipc';
  return via === 'persona' && !openAct() ? 'ipc' : via;
};

/** The door of the current call as the audit and the answers name it: `paired` for the HTTP door, `persona` inside the persona's act, `admin` for the local admin socket, `window` otherwise. */
export const viaOf = (): Through => {
  const via = callOrigin();
  return via === 'web' ? 'paired' : via === 'persona' ? 'persona' : via === 'admin' ? 'admin' : 'window';
};

// What leaves a channel is always a ContractError: the code is the one the failure's class carries, or 'internal'; the message is the text the person already read.
const coded = (e: unknown): ContractError => (e instanceof ContractError ? e : new ContractError(errorCodeOf(e), e instanceof Error ? e.message : String(e)));

// Every failure of a channel call lands in the error log, whichever door it came through. The arguments never do.
function guarded(channel: string, via: Via, run: (...args: never[]) => unknown, raw: never[]): unknown {
  // A call made for a renderer job carries the job id as a trailing marker; the handler never sees it.
  const { args: given, jobId } = takeContext(raw);
  const args = given as never[];
  const fail = (e: unknown): never => {
    logError(`rpc:${channel}`, e, rpcContext(channel, args, via));
    throw coded(e);
  };
  try {
    const result = origin.run(via, () => withActivityContext(jobId, () => run(...args)));
    return result instanceof Promise ? result.catch(fail) : result;
  } catch (e) {
    return fail(e);
  }
}

/** The handshake: a client names the contract version it was built with, and the instance answers its own or refuses with both. */
export function hello(clientVersion: unknown): Hello {
  if (clientVersion !== CONTRACT_VERSION) throw contractMismatch(typeof clientVersion === 'number' ? clientVersion : String(clientVersion), CONTRACT_VERSION);
  return { version: CONTRACT_VERSION };
}

/** Runs a call and settles it to a value or a { code, message }, for a transport that would otherwise lose the code of a thrown error (Electron's IPC). */
export async function settle(run: () => unknown): Promise<Settled> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    return { ok: false, error: wireErrorOf(e) };
  }
}

export function handle(channel: string, fn: Handler): void {
  // i18n-ignore: developer error: a channel registered twice
  if (table.has(channel)) throw new Error(`canal duplicado: ${channel}`);
  table.set(channel, fn);
  bind?.(channel, fn);
}

export function handleDevice(channel: string, fn: (deviceId: string, ...args: never[]) => unknown): void {
  // i18n-ignore: developer error: a channel registered twice
  if (table.has(channel) || deviceTable.has(channel)) throw new Error(`canal duplicado: ${channel}`);
  deviceTable.set(channel, fn);
}

// Registers the IPC side: handlers already in the table and every one added later.
export function bindIpc(binder: Binder): void {
  bind = (channel, fn) => binder(channel, (...args: never[]) => guarded(channel, 'ipc', fn, args));
  for (const [channel, fn] of table) bind(channel, fn);
}

export function hasChannel(channel: string): boolean {
  return table.has(channel) || deviceTable.has(channel);
}

export function channels(): string[] {
  return [...table.keys()];
}

/** The channels only a paired browser's device reaches; the contract names them with the others. */
export function deviceChannels(): string[] {
  return [...deviceTable.keys()];
}

// Called inside every call of the HTTP door before the handler runs: the passkey module uses it for the channels that need a step-up whatever their handler does.
let webGate: ((channel: string) => void) | null = null;
export const setWebGate = (fn: ((channel: string) => void) | null): void => {
  webGate = fn;
};

export async function invoke(channel: string, args: unknown[], deviceId?: string, step?: Omit<StepUpContext, 'deviceId'>): Promise<unknown> {
  // A call of a paired browser carries its device, origin and assertion for the passkey step-up, across the awaits of the handler.
  if (deviceId) return stepUpContext.run({ deviceId, ...step }, () => invokeWeb(channel, args, deviceId));
  return invokeWeb(channel, args, deviceId);
}

async function invokeWeb(channel: string, args: unknown[], deviceId?: string): Promise<unknown> {
  const dev = deviceTable.get(channel);
  if (dev) {
    if (!deviceId) throw new ContractError('browser-only', t('main.rpc.browserOnly', { channel }));
    return guarded(channel, 'web', ((...a: never[]) => (dev as (d: string, ...a: unknown[]) => unknown)(deviceId, ...a)) as Handler, args as never[]);
  }
  const fn = table.get(channel);
  if (!fn) throw new ContractError('unknown-channel', t('main.rpc.unknownChannel', { channel }));
  return guarded(channel, 'web', ((...a: never[]) => {
    webGate?.(channel);
    return fn(...a);
  }) as Handler, args as never[]);
}

/**
 * Runs the handler of a channel under the persona origin, through the same wrapper every call goes through (error log, job id, activity context). Only the persona's door calls
 * it, inside an open act; a `persona:` channel is refused here as a second line behind the door's table, and the phone's policy is not consulted: that is the device's limit.
 */
export function invokePersona(channel: string, args: unknown[]): unknown {
  // i18n-ignore: developer error: the door is the only caller and keeps an act open
  if (!openAct()) throw new Error(`invokePersona outside an act: ${channel}`);
  if (channel.startsWith('persona:')) throw new ContractError('unknown-channel', t('main.rpc.unknownChannel', { channel }));
  const fn = table.get(channel);
  if (!fn) throw new ContractError('unknown-channel', t('main.rpc.unknownChannel', { channel }));
  return guarded(channel, 'persona', fn, args as never[]);
}

/**
 * A call from the local admin socket: the same table the window uses, with the window's rights (the person at the socket is the user the core runs as; the paired-browser rules
 * are the device's limit and do not apply). The origin is its own so the audit can say the call came by that door. The channels only a window or a paired device serves are not here.
 */
export function invokeAdmin(channel: string, args: unknown[]): Promise<unknown> {
  const fn = table.get(channel);
  if (!fn) return Promise.reject(new ContractError('unknown-channel', t('main.rpc.unknownChannel', { channel })));
  return Promise.resolve().then(() => guarded(channel, 'admin', fn, args as never[]));
}
