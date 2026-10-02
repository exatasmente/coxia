import { takeContext } from '../shared/activity';
import { withActivityContext } from './activity';
import { rpcContext } from './errorlog-core';
import { logError } from './errorlog';

type Handler = (...args: never[]) => unknown;
type Binder = (channel: string, fn: Handler) => void;

// One registry for every channel: the Electron window reaches it through ipcMain, the browser through the HTTP RPC.
const table = new Map<string, Handler>();
// Channels that only make sense for one browser device (push subscriptions): the HTTP RPC passes the device id, IPC never reaches them.
const deviceTable = new Map<string, (deviceId: string, ...args: never[]) => unknown>();
let bind: Binder | null = null;

// Every failure of a channel call lands in the error log, whichever door it came through. The arguments never do.
function guarded(channel: string, via: 'ipc' | 'web', run: (...args: never[]) => unknown, raw: never[]): unknown {
  // A call made for a renderer job carries the job id as a trailing marker; the handler never sees it.
  const { args: given, jobId } = takeContext(raw);
  const args = given as never[];
  const fail = (e: unknown): never => {
    logError(`rpc:${channel}`, e, rpcContext(channel, args, via));
    throw e;
  };
  try {
    const result = withActivityContext(jobId, () => run(...args));
    return result instanceof Promise ? result.catch(fail) : result;
  } catch (e) {
    return fail(e);
  }
}

export function handle(channel: string, fn: Handler): void {
  if (table.has(channel)) throw new Error(`canal duplicado: ${channel}`);
  table.set(channel, fn);
  bind?.(channel, fn);
}

export function handleDevice(channel: string, fn: (deviceId: string, ...args: never[]) => unknown): void {
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

export async function invoke(channel: string, args: unknown[], deviceId?: string): Promise<unknown> {
  const dev = deviceTable.get(channel);
  if (dev) {
    if (!deviceId) throw new Error(`canal ${channel} só funciona pelo navegador`);
    return guarded(channel, 'web', ((...a: never[]) => (dev as (d: string, ...a: unknown[]) => unknown)(deviceId, ...a)) as Handler, args as never[]);
  }
  const fn = table.get(channel);
  if (!fn) throw new Error(`canal desconhecido: ${channel}`);
  return guarded(channel, 'web', fn, args as never[]);
}
