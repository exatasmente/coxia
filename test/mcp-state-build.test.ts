// The build entry and the electron-freeness of the CLI (plan D1/D5): the config file exposes an mcp-state input, and no module the CLI pulls
// through its entry imports Electron.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const configText = readFileSync(join(process.cwd(), 'electron.vite.config.ts'), 'utf8');

describe('the second main build entry', () => {
  it('exists for mcp-state, next to the window entry', () => {
    expect(configText).toMatch(/input:\s*\{\s*index:/);
    expect(configText).toMatch(/'mcp-state':/);
    expect(configText).toMatch(/mcp-state[\\/]cli\.ts/);
  });

  it('the CLI imports no electron, directly or through its own folder', () => {
    // The persona's tools are listed from the persona's own catalog (names, descriptions, schemas, the door's texts), which the CLI pulls in too.
    const files = ['src/main/mcp-state/cli.ts', 'src/main/mcp-state/server.ts', 'src/main/mcp-state/tools.ts', 'src/main/mcp-state/entry.ts', 'src/main/mcp-state/bridge.ts', 'src/main/mcp-state/actTools.ts'];
    const catalog = ['src/main/persona/tools.ts', 'src/main/persona/doorTable.ts', 'src/main/persona/args.ts', 'src/main/persona/toolDocs.ts', 'src/main/persona/doorText.ts', 'src/shared/personaTools.ts'];
    for (const file of [...files, ...catalog]) {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      expect(text, file).not.toMatch(/from ['"]electron['"]|require\(['"]electron['"]\)/);
    }
  });
});
