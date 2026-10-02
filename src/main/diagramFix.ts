import { createHash } from 'node:crypto';
import { askAgent, obj, str } from './agents';
import type { Module } from './module';

export const MAX_CODE = 6000;
const MAX_ERROR = 600;

const fixes = new Map<string, Promise<string>>();

function fence(code: string): string {
  return code.replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/, '').trim();
}

async function ask(code: string, error: string): Promise<string> {
  const r = await askAgent<{ code: string }>(
    'reply',
    [
      'O diagrama mermaid abaixo não renderiza (mermaid 12). Corrija somente a sintaxe, mantendo o significado, os rótulos e a estrutura.',
      'Dicas: rótulos com símbolos ou parênteses vão entre aspas; sem estilos, cores nem diretivas; flowchart e sequenceDiagram.',
      `Erro do mermaid:\n${error.slice(0, MAX_ERROR)}`,
      `Código:\n${code}`,
      '"code": o diagrama corrigido completo, sem cerca de ``` e sem comentários.',
    ].join('\n\n'),
    obj({ code: str }),
    { maxTurns: 1, tools: [] },
  );
  const fixed = fence(r.data.code);
  if (!fixed || fixed === code) throw new Error('no fix');
  return fixed;
}

// One call per distinct broken code, kept in memory so a remount never resends it; a failed call (network, quota) is not kept.
export function fixDiagram(rawCode: unknown, error: unknown): Promise<string> {
  const code = fence(String(rawCode ?? ''));
  if (!code || code.length > MAX_CODE) return Promise.reject(new Error('diagram too large to fix'));
  const key = createHash('sha256').update(code).digest('hex');
  let pending = fixes.get(key);
  if (!pending) {
    pending = ask(code, String(error ?? ''));
    fixes.set(key, pending);
    pending.catch((e: Error) => {
      if (e.message !== 'no fix') fixes.delete(key);
    });
  }
  return pending;
}

export function clearFixes(): void {
  fixes.clear();
}

export const register: Module = (ctx) => {
  ctx.handle('diagram:fix', (code: unknown, error: unknown) => fixDiagram(code, error));
};
