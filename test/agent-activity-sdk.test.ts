import { beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
type Step = Msg | ((options: Record<string, unknown>) => Promise<void>);
let scripts: Step[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) {
        if (typeof m === 'function') await m(options);
        else yield m;
      }
    })();
  },
}));

import { activityLog, withActivityContext } from '../src/main/activity';
import { askAgent, obj, str } from '../src/main/agents';
import type { ActivityEntry } from '../src/shared/activity';
import { installEnvSecret, installLegacyConfig } from './helpers/config';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');

const init = (id: string): Msg => ({ type: 'system', subtype: 'init', session_id: id });
const toolUse = (name: string, input: Record<string, unknown>): Msg => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const say = (text: string): Msg => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const toolResult = (content: string): Msg => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content, is_error: false }] } });
const result = (subtype: string, id: string, structured?: unknown): Msg => ({
  type: 'result',
  subtype,
  session_id: id,
  ...(structured === undefined ? {} : { structured_output: structured }),
});

const schema = obj({ fala: str });
const ask = (extra = {}) => askAgent<{ fala: string }>('deep', 'Pergunta', schema, { maxTurns: 3, ...extra });

let pushed: ActivityEntry[] = [];
const rows = (entries: ActivityEntry[]) => entries.map((e) => [e.kind, e.state ?? '', e.label]);

beforeEach(() => {
  scripts = [];
  pushed = [];
  activityLog.clear();
  activityLog.setSink((e) => pushed.push(e));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('activity from the Claude SDK message loop', () => {
  it('reports the start, each tool as its source label, the narration between calls, and the end', async () => {
    scripts = [
      [
        init('s1'),
        say('Vou procurar o filtro.'),
        toolUse('Grep', { pattern: 'filtro' }),
        toolResult('arquivo.php:10: SEGREDO-NO-RESULTADO'),
        toolUse('mcp__tracker__get_issue_details_and_comments', { issue_iid: 15499 }),
        say('{"fala":"final"}'),
        toolUse('StructuredOutput', { fala: 'final' }),
        result('success', 's1', { fala: 'final' }),
      ],
    ];
    const r = await withActivityContext('deep:#1:ask', () => ask());
    expect(r.data).toEqual({ fala: 'final' });
    const entries = activityLog.get('deep:#1:ask');
    expect(rows(entries)).toEqual([
      ['status', 'started', 'Agente iniciado'],
      ['text', '', 'Vou procurar o filtro.'],
      ['tool', '', 'Grep filtro'],
      ['tool', '', 'get_issue_details_and_comments 15499'],
      ['status', 'finished', 'Terminou'],
    ]);
    expect(new Set(entries.map((e) => e.runId)).size).toBe(1);
    expect(entries.every((e) => e.role === 'deep' && e.jobId === 'deep:#1:ask')).toBe(true);
    expect(pushed).toEqual(entries);
  });

  it('never emits what a tool returned, nor the final answer', async () => {
    scripts = [[init('s1'), toolUse('Read', { file_path: '/p/a.ts' }), toolResult('SEGREDO-NO-RESULTADO conteúdo do arquivo'), say('SEGREDO-NO-RESULTADO repetido'), result('success', 's1', { fala: 'SEGREDO-FINAL' })]];
    await ask();
    const wire = JSON.stringify(pushed);
    expect(wire).not.toContain('SEGREDO');
  });

  it('redacts a token-like string and a secret file path in a label', async () => {
    scripts = [
      [
        init('s1'),
        toolUse('Bash', { command: 'glab api -H "PRIVATE-TOKEN: glpat-abcdefghij1234567890" projects/1' }),
        toolUse('Read', { file_path: '/home/x/projects/app/.env' }),
        say('Achei a chave sk-ant-api03-abcdefghijklmnopqrstuvwxyz na configuração.'),
        toolUse('Grep', { pattern: 'a' }),
        result('success', 's1', { fala: 'ok' }),
      ],
    ];
    await ask();
    const wire = JSON.stringify(pushed);
    expect(wire).not.toContain('glpat-abcdefghij');
    expect(wire).not.toContain('sk-ant-api03-abcdefghijklmnop');
    expect(wire).not.toContain('/.env');
    expect(pushed.some((e) => e.label === 'Read [arquivo secreto]')).toBe(true);
    expect(pushed.some((e) => e.kind === 'text' && e.label.includes('[key]'))).toBe(true);
  });

  it('shows "blocked" when a hook refuses a call, with the call and not the reason given to the agent', async () => {
    scripts = [
      [
        init('s1'),
        toolUse('Bash', { command: 'rm -rf /tmp/x' }),
        async (options) => {
          const hooks = options.hooks as { PreToolUse: { matcher: string; hooks: ((i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<unknown>)[] }[] };
          const bash = hooks.PreToolUse.find((g) => g.matcher === 'Bash') as (typeof hooks.PreToolUse)[number];
          await bash.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' }, cwd: '/tmp' }, undefined, { signal: new AbortController().signal });
          await bash.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'glab api projects/a%2Fb/issues/1/notes' }, cwd: '/tmp' }, undefined, { signal: new AbortController().signal });
        },
        result('success', 's1', { fala: 'ok' }),
      ],
    ];
    await ask();
    const blocked = pushed.filter((e) => e.state === 'blocked');
    expect(blocked.map((e) => e.label)).toEqual(['Bloqueado: Bash rm -rf /tmp/x']);
    expect(blocked[0].kind).toBe('status');
  });

  it('keeps one run across the resume for a partial answer, and says so', async () => {
    scripts = [
      [init('s1'), toolUse('Read', { file_path: '/p/a.ts' }), result('error_max_turns', 's1')],
      [init('s1'), result('success', 's1', { fala: 'parcial' })],
    ];
    const r = await withActivityContext('deep:#2:ask', () => ask());
    expect(r.partial).toBe(true);
    const entries = activityLog.get('deep:#2:ask');
    expect(rows(entries).map((x) => x[1] || x[0])).toEqual(['started', 'tool', 'resumed', 'finished']);
    expect(new Set(entries.map((e) => e.runId)).size).toBe(1);
  });

  it('reports a failure with its reason, redacted', async () => {
    scripts = [[init('s1'), result('error_during_execution', 's1')]];
    await expect(ask()).rejects.toThrow();
    const last = pushed[pushed.length - 1];
    expect(last).toMatchObject({ kind: 'status', state: 'failed' });
    expect(last.label).toMatch(/^Falhou: /);
  });

  it('files the runs of a call that is not a job under no job', async () => {
    scripts = [[init('s1'), toolUse('Glob', { pattern: '*.ts' }), result('success', 's1', { fala: 'ok' })]];
    await ask();
    expect(activityLog.get(null).map((e) => e.label)).toContain('Glob *.ts');
    expect(pushed.every((e) => e.jobId === null)).toBe(true);
  });
});
