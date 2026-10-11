// Every feature module modules.ts imports is in the list the app registers. A module imported and left out of `ALL` is bundled away and never registered: its channels do
// not exist when the app runs (the state server's were missing so, and Settings had nothing to show).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve(), getAppPath: () => '/nowhere' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const source = readFileSync(join(process.cwd(), 'src/main/modules.ts'), 'utf8');

describe('the list of modules the app registers', () => {
  it('holds every module the file imports', () => {
    const imported = [...source.matchAll(/^import \{([^}]+)\} from '[^']+';$/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type ')).map((s) => s.split(/\s+as\s+/).pop() as string));
    const list = source.slice(source.indexOf('const ALL: Module[] = ['), source.indexOf('];', source.indexOf('const ALL: Module[] = [')));
    const listed = new Set([...list.matchAll(/^\s+(\w+),$/gm)].map((m) => m[1]));
    expect(imported.length).toBeGreaterThan(30);
    expect(imported.filter((name) => !listed.has(name))).toEqual([]);
  });

  it('holds the state server module, whose channels Settings and the terminal bridge need', async () => {
    const { moduleList } = await import('../src/main/modules');
    const { mcpStateModule } = await import('../src/main/mcp-state/module');
    expect(moduleList()).toContain(mcpStateModule);
  });
});
