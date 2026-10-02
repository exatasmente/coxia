import type { RendererKind } from '../../shared/errorlog';
import { api } from './api';
import { isWeb } from './platform';

// Already in the log by another door (main logs every failed channel call) or just the connection going away.
const IGNORED = /ResizeObserver loop|^Script error\.?$|Failed to fetch|Load failed|NetworkError|Error invoking remote method|^Erro \d{3}$/i;
const MAX_PER_MINUTE = 10;
const REPEAT_MS = 30_000;

const recent: number[] = [];
const seen = new Map<string, number>();

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack };
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; stack?: unknown };
    return { message: typeof e.message === 'string' ? e.message : 'objeto sem mensagem', stack: typeof e.stack === 'string' ? e.stack : undefined };
  }
  return { message: String(error) };
}

// Sends one renderer error to the main process log. Quiet by design: a failing reporter must never become another error.
export function reportRenderer(kind: RendererKind, error: unknown, extra?: string): void {
  try {
    const { message, stack } = describe(error);
    // A failure that already has a status came from an RPC the main process logged.
    if (IGNORED.test(message) || typeof (error as { status?: unknown } | null)?.status === 'number') return;
    const now = Date.now();
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    if (recent.length >= MAX_PER_MINUTE || now - (seen.get(message) ?? 0) < REPEAT_MS) return;
    recent.push(now);
    seen.set(message, now);
    if (seen.size > 50) seen.delete(seen.keys().next().value as string);
    const body = { kind, message: message.slice(0, 500), stack: [stack, extra].filter(Boolean).join('\n').slice(0, 3000), platform: isWeb() ? 'web' : 'desktop' };
    void api.invoke('log:renderer', body).catch(() => {});
  } catch {}
}

export function installErrorReporting(): void {
  window.addEventListener('error', (e) => reportRenderer('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportRenderer('unhandledrejection', e.reason));
}
