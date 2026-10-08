// A bare call (askBare) on the open engine: the request to the server offers no tool but the transport of the structured answer (`final_answer`), and the system text
// carries neither the CLAUDE.md or AGENTS.md of the working directory or the home nor an index of documentation folders. The same question asked through askAgent,
// from the same folder, carries them, so these cases tell the two apart. Both ways to reach the engine: the environment hook and a provider of the config.
// The server is a local fake: no model, no network.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The home of the person is where Claude Code keeps its own notes: here it is a folder of this test, set before any module reads it.
const sandbox = vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bare-open-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'MARK-HOME-NOTES');
  process.env.HOME = home;
  return { root, home };
});

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { askAgent, askBare, obj, str } from '../src/main/agents';
import { ATAS } from '../src/main/env';
import { newProvider } from '../src/shared/config/defaults';
import { installEnvSecret, installLegacyConfig } from './helpers/config';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

const schema = obj({ fala: str });
const SYSTEM = 'You write questions for the person. MARK-ASSISTANT-SYSTEM';
const rulesDir = join(sandbox.root, 'rules');
let fake: Fake;

const bare = () => askBare<{ fala: string }>('deep', 'What should the agent do?', schema, { system: SYSTEM });
const ceremony = () => askAgent<{ fala: string }>('deep', 'What should the agent do?', schema, { maxTurns: 2 });

beforeAll(async () => {
  await installLegacyConfig();
  await installEnvSecret('llm.openrouter');
  // the working directory of the bare call holds what Claude Code and the agents would read
  writeFileSync(join(ATAS, 'CLAUDE.md'), 'MARK-CWD-CLAUDE');
  writeFileSync(join(ATAS, 'AGENTS.md'), '# Project instructions\n\nMARK-CWD-AGENTS\n');
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, 'mark-rule-index.md'), 'MARK-RULE-BODY');
  fake = await fakeOpenAI(() => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]));
  const { updateConfig } = await import('../src/main/workspaceConfig');
  updateConfig((c) => {
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: fake.url, structured: 'tool' }));
    // the ceremonies work from the same folder, and list a folder of rules as documentation
    c.projects.roots = [ATAS];
    c.docs.autoDetect = true;
    c.docs.rulesDirs = [rulesDir];
    return c;
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(sandbox.root, { recursive: true, force: true });
});

beforeEach(() => {
  fake.requests.length = 0;
  vi.unstubAllEnvs();
});

const throughHook = (): void => {
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'qwen3:8b');
  vi.stubEnv('COXIA_LLM_STRUCTURED', 'tool');
};

// The role is mapped to a provider of the config that the open engine serves, as a person would; the returned function puts the mapping back.
const throughProvider = async (): Promise<() => void> => {
  const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');
  const before = getConfig().llm.roles.deep;
  updateConfig((c) => {
    c.llm.roles.deep = { provider: 'local', model: 'qwen3:8b' };
    return c;
  });
  return () => {
    updateConfig((c) => {
      c.llm.roles.deep = before;
      return c;
    });
  };
};

/** The first request of the call: what the server was offered, and the system text. */
const sent = (): { tools: string[]; system: string; chats: number } => {
  const body = fake.chats()[0].body as { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] };
  return {
    tools: (body.tools ?? []).map((t) => t.function.name),
    system: body.messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n'),
    chats: fake.chats().length,
  };
};

const NOTHING_OF_THE_FOLDERS = ['MARK-CWD-CLAUDE', 'MARK-CWD-AGENTS', 'MARK-HOME-NOTES', 'mark-rule-index', 'MARK-RULE-BODY'];

describe('a bare call on the open engine, through the environment hook', () => {
  it('offers the server no tool but the transport of the answer', async () => {
    throughHook();
    const r = await bare();
    expect(r.data).toEqual({ fala: 'done' });
    const request = sent();
    expect(request.tools).toEqual(['final_answer']);
    expect(request.chats).toBe(1);
  });

  it('carries the text of the caller and none of the documentation, the folders listed or the notes', async () => {
    throughHook();
    await bare();
    const { system } = sent();
    expect(system).toContain('MARK-ASSISTANT-SYSTEM');
    for (const mark of NOTHING_OF_THE_FOLDERS) expect(system).not.toContain(mark);
  });

  it('is told the folder it works in, which is the data folder', async () => {
    throughHook();
    await bare();
    expect(sent().system).toContain(`Working directory: ${ATAS}`);
  });
});

describe('a bare call on the open engine, through a provider of the config', () => {
  it('offers the server no tool but the transport of the answer, and no documentation', async () => {
    const restore = await throughProvider();
    try {
      await bare();
      const { tools, system, chats } = sent();
      expect(tools).toEqual(['final_answer']);
      expect(chats).toBe(1);
      expect(system).toContain('MARK-ASSISTANT-SYSTEM');
      for (const mark of NOTHING_OF_THE_FOLDERS) expect(system).not.toContain(mark);
    } finally {
      restore();
    }
  });
});

describe('the same question without bare, from the same folder', () => {
  it('offers the read tools and puts the notes and the index of documentation in the system text, through the hook', async () => {
    throughHook();
    await ceremony();
    const { tools, system } = sent();
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'final_answer']));
    expect(system).toContain('MARK-CWD-CLAUDE');
    expect(system).toContain('MARK-HOME-NOTES');
    expect(system).not.toContain('MARK-ASSISTANT-SYSTEM');
  });

  it('does the same through a provider of the config, with the folder of rules in the index', async () => {
    const restore = await throughProvider();
    try {
      await ceremony();
      const { tools, system } = sent();
      expect(tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'final_answer']));
      expect(system).toContain('mark-rule-index');
      // AGENTS.md reaches an agent through the documentation the runner hands it (runAgent), never by being found in a folder
      expect(system).not.toContain('MARK-CWD-AGENTS');
    } finally {
      restore();
    }
  });
});
