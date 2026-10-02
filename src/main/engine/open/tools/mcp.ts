// A minimal MCP client over stdio (newline-delimited JSON-RPC 2.0): initialize, tools/list, tools/call. Only the servers that hold at
// least one allowed tool are started, and only the allowed tools are exposed, namespaced mcp__<server>__<tool> like Claude Code does.
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Json } from '../types';
import { type ToolImpl, ToolError, clip } from './types';
import { t } from '../../../../shared/i18n';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  type?: string;
  url?: string;
}

// Reads { "mcpServers": { name: { command, args, env } } } files (.mcp.json, ~/.claude.json). Remote (http/sse) servers are skipped.
export function loadMcpConfigs(files: string[]): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const file of files) {
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, McpServerConfig> };
      for (const [name, cfg] of Object.entries(json.mcpServers ?? {})) {
        if (cfg && typeof cfg.command === 'string' && (!cfg.type || cfg.type === 'stdio') && !(name in out)) out[name] = cfg;
      }
    } catch {
      // a missing or unreadable file just contributes nothing
    }
  }
  return out;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class McpClient {
  private proc: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  closed = false;

  constructor(
    readonly name: string,
    private cfg: McpServerConfig,
    private timeoutMs = 60_000,
  ) {}

  private start(): Promise<void> {
    this.ready ??= (async () => {
      const proc = spawn(this.cfg.command, this.cfg.args ?? [], {
        cwd: this.cfg.cwd,
        env: { ...process.env, ...this.cfg.env },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      this.proc = proc;
      proc.stdout?.setEncoding('utf8');
      proc.stdout?.on('data', (d: string) => this.onData(d));
      proc.on('error', (e) => this.fail(new Error(t('main.engine.text.mcp.failed', { name: this.name, detail: e.message }))));
      proc.on('exit', () => {
        this.closed = true;
        this.fail(new Error(t('main.engine.text.mcp.exited', { name: this.name })));
      });
      await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'coxia', version: '1' } });
      this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    })();
    return this.ready;
  }

  private send(msg: Json): void {
    this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
        if (!p || msg.id === undefined) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message ?? t('main.engine.text.mcp.error')));
        else p.resolve(msg.result);
      } catch {
        // a log line on stdout is not a message
      }
    }
  }

  private fail(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private request(method: string, params: Json): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(t('main.engine.text.mcp.timeout', { name: this.name, method })));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async listTools(): Promise<{ name: string; description?: string; inputSchema?: Json }[]> {
    await this.start();
    const res = (await this.request('tools/list', {})) as { tools?: { name: string; description?: string; inputSchema?: Json }[] };
    return res.tools ?? [];
  }

  async callTool(name: string, args: Json): Promise<{ text: string; isError: boolean }> {
    await this.start();
    const res = (await this.request('tools/call', { name, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean };
    const text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n');
    return { text, isError: res.isError === true };
  }

  close(): void {
    this.closed = true;
    this.proc?.kill();
  }
}

// One process per server for the life of the app: starting a Python MCP server costs seconds.
const pool = new Map<string, McpClient>();

export function closeAllMcp(): void {
  for (const c of pool.values()) c.close();
  pool.clear();
}

function poolClient(name: string, cfg: McpServerConfig): McpClient {
  const key = `${name}:${JSON.stringify(cfg)}`;
  const cur = pool.get(key);
  if (cur && !cur.closed) return cur;
  const fresh = new McpClient(name, cfg);
  pool.set(key, fresh);
  return fresh;
}

function allowedBy(allow: string[], server: string, tool: string): boolean {
  const full = `mcp__${server}__${tool}`;
  return allow.some((a) => a === full || a === `mcp__${server}` || a === `mcp__${server}__*`);
}

// The tools of the servers that hold an allowed one, as ToolImpl. A server that fails to start is skipped, not fatal.
export async function mcpTools(servers: Record<string, McpServerConfig>, allow: string[], onError?: (server: string, e: Error) => void): Promise<ToolImpl[]> {
  const out: ToolImpl[] = [];
  const wanted = Object.keys(servers).filter((s) => allow.some((a) => a.startsWith(`mcp__${s}__`) || a === `mcp__${s}`));
  await Promise.all(
    wanted.map(async (server) => {
      const client = poolClient(server, servers[server]);
      try {
        for (const tool of await client.listTools()) {
          if (!allowedBy(allow, server, tool.name)) continue;
          out.push({
            name: `mcp__${server}__${tool.name}`,
            description: tool.description ?? tool.name,
            parameters: tool.inputSchema ?? { type: 'object', properties: {} },
            async run(input, ctx) {
              const r = await client.callTool(tool.name, input);
              if (r.isError) throw new ToolError(r.text || t('main.engine.text.mcp.toolError'));
              return { response: r.text, render: (x) => clip(String(x), ctx.outputMax) };
            },
          });
        }
      } catch (e) {
        onError?.(server, e as Error);
      }
    }),
  );
  return out;
}
