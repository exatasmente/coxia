type Handler = (...args: never[]) => unknown;
type Binder = (channel: string, fn: Handler) => void;

// One registry for every channel: the Electron window reaches it through ipcMain, the browser through the HTTP RPC.
const table = new Map<string, Handler>();
// Channels that only make sense for one browser device (push subscriptions): the HTTP RPC passes the device id, IPC never reaches them.
const deviceTable = new Map<string, (deviceId: string, ...args: never[]) => unknown>();
let bind: Binder | null = null;

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
  bind = binder;
  for (const [channel, fn] of table) binder(channel, fn);
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
    return (dev as (d: string, ...a: unknown[]) => unknown)(deviceId, ...args);
  }
  const fn = table.get(channel);
  if (!fn) throw new Error(`canal desconhecido: ${channel}`);
  return (fn as (...a: unknown[]) => unknown)(...args);
}
