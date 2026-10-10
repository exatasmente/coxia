// The reasoning of the open engine as one closed line per turn, through the real askAgent against a fake OpenAI server: whichever way the server sends it, once per turn
// that reasoned, before that turn's narration and tools, masked and cut, behind the workspace's switch, and never a tool result or the closing answer.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_THOUGHT_MAX, type ActivityEntry } from '../src/shared/activity';
import { t } from '../src/shared/i18n';
import { type Fake, type Step, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let home: string;
let projects: string;
let fake: Fake;
let agents: typeof import('../src/main/agents');
let log: typeof import('../src/main/activity');
// The step for the n-th model call of the test (the fake server counts across the whole file).
let script: (n: number, tools: string[], messages: { role: string; content: unknown }[]) => Step = () => textStep('');
let calls = 0;
let pushed: ActivityEntry[] = [];

const FILE_MARKER = 'conteudo-secreto-da-nota';
const FINAL = 'resposta-final-secreta';
const final = (extra: { reasoning?: string | string[]; text?: string } = {}): Step => toolStep([{ name: 'final_answer', args: { fala: FINAL } }], extra);
const read = (id: string, reasoning?: string | string[], extra: { text?: string; reasoningField?: string } = {}): Step => toolStep([{ id, name: 'Read', args: { file_path: join(projects, 'note.txt') } }], { reasoning, ...extra });

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'activity-thoughts-home-'));
  projects = join(home, 'projects');
  mkdirSync(projects);
  writeFileSync(join(projects, 'note.txt'), `${FILE_MARKER}\nsegunda linha\n`);
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI((req) => {
    const body = req.body as { messages?: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] };
    return script(++calls, (body.tools ?? []).map((x) => x.function.name), body.messages ?? []);
  });
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  agents = await import('../src/main/agents');
  log = await import('../src/main/activity');
  await (await import('./helpers/config')).installLegacyConfig();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  calls = 0;
  pushed = [];
  log.activityLog.clear();
  log.setThoughtsGate(() => true);
  log.activityLog.setSink((e) => pushed.push(e));
});

const ask = (job: string) => log.withActivityContext(job, () => agents.askAgent<{ fala: string }>('deep', 'Onde está a nota?', agents.obj({ fala: agents.str }), { maxTurns: 8 }));
const kinds = (entries: readonly ActivityEntry[]) => entries.map((e) => [e.kind, e.state ?? e.label]);
const thoughts = (entries: readonly ActivityEntry[]) => entries.filter((e) => e.kind === 'thought');

describe('one thought per turn that reasoned, from the open engine', () => {
  it('makes exactly one line for a turn, whichever field or block carried it, before that turn\'s narration and tools, and none for a turn that did not reason', async () => {
    script = (n) => {
      if (n === 1) return read('r1', ['I should read ', 'the note first, ', 'then answer.'], { text: 'Vou ler a nota.' });
      if (n === 2) return read('r2', 'Now check it again.', { reasoningField: 'reasoning' });
      if (n === 3) return read('r3');
      return final({ text: '<think>wrap up the answer</think>' });
    };
    const r = await ask('deep:#1:ask');
    expect(r.data).toEqual({ fala: FINAL });
    const entries = log.activityLog.get('deep:#1:ask');
    expect(entries).toEqual(pushed);
    expect(kinds(entries)).toEqual([
      ['status', 'started'],
      ['thought', 'I should read the note first, then answer.'],
      ['text', 'Vou ler a nota.'],
      ['tool', expect.stringContaining('Read ')],
      ['thought', 'Now check it again.'],
      ['tool', expect.stringContaining('Read ')],
      ['tool', expect.stringContaining('Read ')],
      ['thought', 'wrap up the answer'],
      ['status', 'finished'],
    ]);
    // a reasoning of many streamed pieces is still one line, and it is not the narration
    expect(thoughts(entries)).toHaveLength(3);
    expect(entries.filter((e) => e.kind === 'text').map((e) => e.label)).toEqual(['Vou ler a nota.']);
    // the stream and the backfill say the same, line by line
    expect(entries.every((e) => e.runId === entries[0].runId && !e.parent)).toBe(true);
  });

  it('never lets a tool result, a file content or the closing answer into a thought or any other line', async () => {
    script = (n) => (n === 1 ? read('r1', 'Reading the note.') : final({ reasoning: 'Done reading.' }));
    await ask('deep:#2:ask');
    const wire = JSON.stringify(pushed);
    for (const leaked of [FILE_MARKER, 'segunda linha', FINAL]) expect(wire).not.toContain(leaked);
    expect(thoughts(pushed).map((e) => e.label)).toEqual(['Reading the note.', 'Done reading.']);
  });

  it('puts the thought of a sub-agent on the sub-agent\'s own node', async () => {
    script = (n, tools, messages) => {
      if (tools.includes('Agent')) {
        const results = messages.filter((m) => m.role === 'tool').length;
        return results === 0 ? toolStep([{ id: 'delegate', name: 'Agent', args: { description: 'find the note', prompt: 'task: find the note', subagent_type: 'explore' } }], { reasoning: 'The stage thinks first.' }) : final();
      }
      return messages.filter((m) => m.role === 'tool').length === 0 ? read('s1', 'The sub-agent thinks.') : textStep('found it');
    };
    await ask('deep:#3:ask');
    const root = pushed.find((e) => !e.parent)?.runId as string;
    const own = pushed.filter((e) => e.runId === root);
    const child = pushed.filter((e) => e.runId !== root);
    expect(thoughts(own).map((e) => e.label)).toEqual(['The stage thinks first.']);
    expect(thoughts(child).map((e) => e.label)).toEqual(['The sub-agent thinks.']);
    expect(child.every((e) => e.parent === root)).toBe(true);
    // the sub-agent's thought comes before its own tool line
    expect(kinds(child).map((k) => k[0])).toEqual(['status', 'thought', 'tool', 'status']);
  });
});

describe('what a thought may carry', () => {
  it('replaces a credential shape and a secret-file path, as every other line does', async () => {
    const secretPath = join(projects, '.env');
    script = (n) => final({ reasoning: `Look at ${secretPath} and use glpat-abcdefghij1234567890 to log in.` });
    await ask('deep:#4:ask');
    const [thought] = thoughts(pushed);
    expect(thought.label).not.toContain('glpat-abcdefghij');
    expect(thought.label).not.toContain('.env');
    expect(thought.label).toContain('[key]');
    expect(thought.label).toContain(t('activity.secretFile'));
  });

  it('cuts a long thought at the cap with an ellipsis, keeping the start', async () => {
    const long = `START ${'word '.repeat(1500)}END`;
    script = () => final({ reasoning: long });
    await ask('deep:#5:ask');
    const [thought] = thoughts(pushed);
    expect(thought.label.length).toBeLessThanOrEqual(ACTIVITY_THOUGHT_MAX);
    expect(thought.label.startsWith('START word word')).toBe(true);
    expect(thought.label.endsWith('…')).toBe(true);
    expect(thought.label).not.toContain('END');
  });

  it('still shows the masked start of a reasoning longer than what the masking scans', async () => {
    const huge = `glpat-abcdefghij1234567890 ${'filler '.repeat(8000)}`;
    expect(huge.length).toBeGreaterThan(40_000);
    script = () => final({ reasoning: huge });
    await ask('deep:#6:ask');
    const [thought] = thoughts(pushed);
    expect(thought.label.startsWith('[key] filler')).toBe(true);
    expect(thought.label.length).toBeLessThanOrEqual(ACTIVITY_THOUGHT_MAX);
  });

  it('gives the window and a phone the same masked text: the stream and the backfill are one', async () => {
    script = () => final({ reasoning: 'Token is glpat-abcdefghij1234567890 here.' });
    await ask('deep:#7:ask');
    expect(log.activityLog.get('deep:#7:ask')).toEqual(pushed);
    expect(JSON.stringify(log.activityLog.get('deep:#7:ask'))).not.toContain('glpat-abcdefghij');
  });

  it('writes the thought into no file of the data folder besides the engine\'s own session file', async () => {
    const marker = 'MARCADOR-DE-PENSAMENTO-UNICO';
    script = () => final({ reasoning: marker });
    await ask('deep:#8:ask');
    expect(thoughts(pushed)).toHaveLength(1);
    const root = process.env.CERIMONIAS_DATA_DIR as string;
    const found: string[] = [];
    // The open engine keeps the principal's own reasoning in its session file, as it did before this feature: that file is the one place it is allowed to be.
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (path.includes('open-sessions')) continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (readFileSync(path, 'utf8').includes(marker)) found.push(path);
      }
    };
    walk(root);
    expect(found).toEqual([]);
  });
});

describe('the switch', () => {
  it('makes no thought while it is off, keeps the ones already made, and shows the next turn\'s once it is on again', async () => {
    script = (n) => (n === 1 ? read('r1', 'First thought.') : final({ reasoning: 'Closing thought.' }));
    await ask('deep:#9:ask');
    expect(thoughts(pushed).map((e) => e.label)).toEqual(['First thought.', 'Closing thought.']);

    log.setThoughtsGate(() => false);
    calls = 0;
    pushed = [];
    log.activityLog.setSink((e) => pushed.push(e));
    await ask('deep:#9:ask');
    // nothing reached the window or a phone, and the rest of the lines are the same
    expect(thoughts(pushed)).toEqual([]);
    expect(pushed.map((e) => e.kind)).toEqual(['status', 'tool', 'status']);
    // what was made while it was on stays until it ages out
    expect(thoughts(log.activityLog.get('deep:#9:ask'))).toEqual([]);
    const earlier = log.activityLog.get(pushed[0].runId);
    expect(earlier.some((e) => e.kind === 'thought')).toBe(false);

    log.setThoughtsGate(() => true);
    calls = 0;
    pushed = [];
    log.activityLog.setSink((e) => pushed.push(e));
    await ask('deep:#9:ask');
    expect(thoughts(pushed).map((e) => e.label)).toEqual(['First thought.', 'Closing thought.']);
  });

  it('reads the switch from the workspace\'s configuration when the app points the log at it', async () => {
    const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
    const { reasoningOn } = await import('../src/shared/activity');
    log.setThoughtsGate(() => reasoningOn(getConfig()));
    script = () => final({ reasoning: 'A thought.' });
    await ask('deep:#10:ask');
    expect(thoughts(pushed)).toHaveLength(1);
    const config = getConfig();
    await saveConfig({ ...config, runner: { ...config.runner, showReasoning: false } });
    pushed = [];
    calls = 0;
    log.activityLog.setSink((e) => pushed.push(e));
    await ask('deep:#10:ask');
    expect(thoughts(pushed)).toEqual([]);
    await saveConfig({ ...config, runner: { ...config.runner, showReasoning: true } });
  });
});
