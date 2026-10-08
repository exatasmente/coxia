// The agents of the team read the project instructions (the root AGENTS.md) the app hands them and nothing of Claude Code's: not the CLAUDE.md or the .claude/ of the
// working directory or the home, not the settings, not the automatic memory. The ceremonies read what they read before. Both engines, with fakes only: the SDK is
// mocked (its options are captured) and the open engine talks to a local fake server.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The home of the person is where Claude Code keeps its own notes: it is a folder of this test, set before any module reads it.
const sandbox = vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-isolation-'));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'projects', 'app');
  const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write(path.join(home, '.claude', 'CLAUDE.md'), 'MARK-HOME-NOTES');
  write(path.join(repo, 'CLAUDE.md'), 'MARK-REPO-NOTES');
  write(path.join(repo, '.claude', 'rules', 'mark-claude-rule.md'), 'MARK-CLAUDE-RULE');
  write(path.join(repo, 'AGENTS.md'), '# Project instructions\n\nMARK-COXIA-OVERVIEW\n');
  process.env.HOME = home;
  return { root, home, repo };
});

type Options = Record<string, unknown>;
const queries: { prompt: string; options: Options }[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Options }) => {
    queries.push({ prompt, options });
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's1' };
      yield { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' } };
    })();
  },
}));

import { rmSync } from 'node:fs';
import { askAgent, obj, runAgent, str } from '../src/main/agents';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret, installLegacyConfig } from './helpers/config';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

const MARKS = ['MARK-HOME-NOTES', 'MARK-REPO-NOTES', 'mark-claude-rule', 'MARK-CLAUDE-RULE'];
const schema = obj({ fala: str });
const asked = { repos: [sandbox.repo], stage: null, paths: [] };
let fake: Fake;

beforeAll(async () => {
  await installLegacyConfig();
  await installEnvSecret('llm.openrouter');
  fake = await fakeOpenAI(() => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]));
  const { updateConfig } = await import('../src/main/workspaceConfig');
  updateConfig((c) => {
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: fake.url, structured: 'tool' }));
    // the ceremonies work from the root of the projects, where Claude Code keeps its notes
    c.projects.roots = [sandbox.repo];
    c.docs.autoDetect = true;
    return c;
  });
});

afterAll(async () => {
  await fake.close();
  rmSync(sandbox.root, { recursive: true, force: true });
});

beforeEach(() => {
  queries.length = 0;
  fake.requests.length = 0;
  vi.unstubAllEnvs();
});

/** What the open engine sent as the system text of the first request. */
const systemText = (): string => {
  const messages = fake.chats()[0].body?.messages as { role: string; content: unknown }[];
  return messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
};

const append = (options: Options): string => String((options.systemPrompt as { append?: string }).append ?? '');

describe('the Claude SDK path', () => {
  it('turns off the settings sources and the automatic memory for a team agent, and still hands it the documentation of the repository', async () => {
    await runAgent({ agent: newAgent({ id: 'developer' }), prompt: 'p', schema, system: 'The job.', cwd: sandbox.repo, label: 'developer', maxTurns: 3, docs: asked });
    const { options } = queries[0];
    expect(options.settingSources).toEqual([]);
    expect(options.settings).toEqual({ autoMemoryEnabled: false });
    expect(append(options)).toContain('The job.');
    expect(append(options)).toContain('MARK-COXIA-OVERVIEW');
    for (const mark of MARKS) expect(JSON.stringify(options)).not.toContain(mark);
  });

  it('isolates a call that asks for no documentation too, and adds no text to it', async () => {
    await runAgent({ agent: newAgent({ id: 'developer' }), prompt: 'p', schema, system: 'The job.', cwd: sandbox.repo, label: 'developer', maxTurns: 3 });
    const { options } = queries[0];
    expect(options.settingSources).toEqual([]);
    expect(append(options)).toBe('The job.');
  });

  it('leaves a ceremony as it is: no sources are named, so Claude Code reads what it read before', async () => {
    await askAgent('deep', 'p', schema, { maxTurns: 2 });
    const { options } = queries[0];
    expect(options).not.toHaveProperty('settingSources');
    expect(options).not.toHaveProperty('settings');
  });
});

describe('the open engine', () => {
  const agent = newAgent({ id: 'developer', model: { role: null, provider: 'local', model: 'qwen3:8b' } });

  it('puts the documentation of the repository in the system text and none of Claude Code, not even the home or the folder up the tree', async () => {
    await runAgent({ agent, prompt: 'p', schema, system: 'The job.', cwd: sandbox.repo, label: 'developer', maxTurns: 3, docs: asked });
    const system = systemText();
    expect(system).toContain('The job.');
    expect(system).toContain('MARK-COXIA-OVERVIEW');
    for (const mark of MARKS) expect(system).not.toContain(mark);
  });

  it('keeps the lists of the config for an agent: the sources the person wrote count, those found by autoDetect do not', async () => {
    const { updateConfig } = await import('../src/main/workspaceConfig');
    const { join } = await import('node:path');
    updateConfig((c) => {
      c.docs.rulesDirs = [join(sandbox.repo, '.claude', 'rules')];
      return c;
    });
    try {
      await runAgent({ agent, prompt: 'p', schema, system: 'The job.', cwd: sandbox.repo, label: 'developer', maxTurns: 3, docs: asked });
      const system = systemText();
      // listed on purpose: its name is in the index of documents
      expect(system).toContain('mark-claude-rule');
      expect(system).not.toContain('MARK-HOME-NOTES');
      expect(system).not.toContain('MARK-REPO-NOTES');
    } finally {
      updateConfig((c) => {
        c.docs.rulesDirs = [];
        return c;
      });
    }
  });

  it('reaches no default source through the environment hook either: the hook carries no docs, and an empty list is not an absent one', async () => {
    vi.stubEnv('COXIA_ENGINE', 'open');
    vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
    vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'qwen3:8b');
    vi.stubEnv('COXIA_LLM_STRUCTURED', 'tool');
    await runAgent({ agent: newAgent({ id: 'developer' }), prompt: 'p', schema, system: 'The job.', cwd: sandbox.repo, label: 'developer', maxTurns: 3, docs: asked });
    const system = systemText();
    expect(system).toContain('MARK-COXIA-OVERVIEW');
    for (const mark of MARKS) expect(system).not.toContain(mark);
  });

  it('leaves a ceremony as it is: the notes of the folder and of the home are still read', async () => {
    vi.stubEnv('COXIA_ENGINE', 'open');
    vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
    vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'qwen3:8b');
    vi.stubEnv('COXIA_LLM_STRUCTURED', 'tool');
    await askAgent('deep', 'p', schema, { maxTurns: 2 });
    const system = systemText();
    expect(system).toContain('MARK-HOME-NOTES');
    expect(system).toContain('MARK-REPO-NOTES');
    expect(system).not.toContain('MARK-COXIA-OVERVIEW');
  });
});

describe('no documentation, no text', () => {
  it('adds nothing to the system text of a repository with no .coxia/', async () => {
    const { join } = await import('node:path');
    const bare = join(sandbox.root, 'projects', 'bare');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(bare, { recursive: true });
    await runAgent({ agent: newAgent({ id: 'developer' }), prompt: 'p', schema, system: 'The job.', cwd: bare, label: 'developer', maxTurns: 3, docs: { repos: [bare], stage: null, paths: [] } });
    expect(append(queries[0].options)).toBe('The job.');
  });
});
