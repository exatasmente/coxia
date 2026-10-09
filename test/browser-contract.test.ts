import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPOSED_TOOLS, PROBE_TOOLS, REF_PATTERN, REFUSED_TOOLS, type Prop, jsonSchemaOf } from '../src/main/browser/allowlist';
import { type McpClient, type McpProp, type McpTool, spawnMcp } from '../src/main/browser/mcpClient';

// The contract with the pinned Playwright MCP server (exact version in package.json): its tool list is read from the real server, which lists them with no browser started.
// A tool that is neither offered nor refused by name, or an offered property the server does not have, fails here, so an upgrade cannot change the surface unnoticed.

let home: string;
let client: McpClient;
let tools: McpTool[];
let close: () => Promise<void>;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'coxia-contract-'));
  const cli = join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')), 'cli.js');
  const s = spawnMcp({ command: process.execPath, args: [cli, '--headless', '--isolated', '--codegen', 'none', '--snapshot-mode', 'none', '--no-webmcp'], env: { PATH: process.env.PATH ?? '', HOME: home }, cwd: home });
  client = s.client;
  close = () => client.close();
  await client.initialize();
  tools = await client.listTools();
}, 60_000);
afterAll(async () => {
  await close?.();
  rmSync(home, { recursive: true, force: true });
});

const byName = (name: string): McpTool => tools.find((t) => t.name === name) as McpTool;
const same = (a: string, b: string): boolean => a === b || (a === 'integer' && b === 'number');

describe('the pinned Playwright MCP server', () => {
  it('has no tool that is neither offered nor refused by name', () => {
    const known = new Set([...EXPOSED_TOOLS.map((t) => t.name), ...REFUSED_TOOLS]);
    const strangers = tools.map((t) => t.name).filter((n) => !known.has(n));
    expect(strangers).toEqual([]);
  });

  it('still has every tool the app names (a rename would leave a hole)', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const n of [...EXPOSED_TOOLS.map((t) => t.name), ...REFUSED_TOOLS, ...PROBE_TOOLS]) expect(names.has(n), n).toBe(true);
    expect(EXPOSED_TOOLS.some((t) => REFUSED_TOOLS.includes(t.name))).toBe(false);
  });

  it('offers no tool that runs script, moves a file, lists the network or closes the browser', () => {
    const offered = EXPOSED_TOOLS.map((t) => t.name).join(' ');
    for (const word of ['evaluate', 'run_code', 'upload', 'drop', 'network', 'console', 'close', 'resize', 'emulate']) expect(offered).not.toContain(word);
  });

  it('has, for every property the app offers, a property of the same kind in the server schema', () => {
    const compare = (own: Prop, theirs: McpProp | undefined, where: string): void => {
      expect(theirs, `${where} is not in the server's schema`).toBeDefined();
      if (!theirs) return;
      if (theirs.type) expect(same(own.type, theirs.type), `${where}: ${own.type} against ${theirs.type}`).toBe(true);
      // Every value the app lets through must be one the server knows.
      if (own.enum && theirs.enum) for (const v of own.enum) expect(theirs.enum, `${where} = ${v}`).toContain(v);
      if (own.items) compare(own.items, theirs.items, `${where}[]`);
      for (const [key, p] of Object.entries(own.properties ?? {})) compare(p, theirs.properties?.[key], `${where}.${key}`);
      for (const key of own.required ?? []) expect(Object.keys(theirs.properties ?? {}), `${where}.${key} required`).toContain(key);
    };
    for (const own of EXPOSED_TOOLS) {
      const theirs = byName(own.name).inputSchema.properties ?? {};
      for (const [key, p] of Object.entries(own.properties)) {
        if (p.appOnly) {
          // The app's own property is never the server's: forwarding it would be refused or, worse, meant.
          expect(theirs[key], `${own.name}.${key} is the app's own`).toBeUndefined();
          continue;
        }
        compare(p, theirs[key], `${own.name}.${key}`);
      }
    }
  });

  it('is told every property it requires and has no default for', () => {
    for (const own of EXPOSED_TOOLS) {
      const schema = byName(own.name).inputSchema;
      const needed = (schema.required ?? []).filter((k) => schema.properties?.[k]?.default === undefined);
      for (const k of needed) expect(own.required, `${own.name} must require ${k}`).toContain(k);
    }
  });

  it('offers no file name, and every target is a ref', () => {
    const walk = (p: Prop, where: string): void => {
      if (where.endsWith('.target') || where.endsWith('Target')) expect(p.pattern, where).toBe(REF_PATTERN);
      for (const [k, v] of Object.entries(p.properties ?? {})) walk(v, `${where}.${k}`);
      if (p.items) walk(p.items, `${where}[]`);
    };
    for (const t of EXPOSED_TOOLS) {
      expect(Object.keys(t.properties)).not.toContain('filename');
      for (const [k, p] of Object.entries(t.properties)) walk(p, `${t.name}.${k}`);
      expect(JSON.stringify(jsonSchemaOf(t))).not.toContain('appOnly');
    }
  });
});
