type Handler = (...args: never[]) => unknown;
type Binder = (channel: string, fn: Handler) => void;

// One registry for every channel: the Electron window reaches it through ipcMain, the browser through the HTTP RPC.
const table = new Map<string, Handler>();
let bind: Binder | null = null;

export function handle(channel: string, fn: Handler): void {
  if (table.has(channel)) throw new Error(`canal duplicado: ${channel}`);
  table.set(channel, fn);
  bind?.(channel, fn);
}

// Registers the IPC side: handlers already in the table and every one added later.
export function bindIpc(binder: Binder): void {
  bind = binder;
  for (const [channel, fn] of table) binder(channel, fn);
}

export function hasChannel(channel: string): boolean {
  return table.has(channel);
}

export function channels(): string[] {
  return [...table.keys()];
}

export async function invoke(channel: string, args: unknown[]): Promise<unknown> {
  const fn = table.get(channel);
  if (!fn) throw new Error(`canal desconhecido: ${channel}`);
  return (fn as (...a: unknown[]) => unknown)(...args);
}
