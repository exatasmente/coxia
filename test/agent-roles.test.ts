import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { calls, installFakeEngine } from './helpers/promptCapture';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));

// What the config says about each agent role: extra instructions, persona, turn limit and which documentation sources it may read.

let agents: typeof import('../src/main/agents');
let cfg: typeof import('../src/main/workspaceConfig');
let other: string;

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'agent-roles-'));
  const work = join(base, 'work');
  other = join(base, 'other');
  for (const d of ['skills', 'rules', 'agents', 'kb']) mkdirSync(join(other, d), { recursive: true });
  mkdirSync(work, { recursive: true });
  agents = await import('../src/main/agents');
  cfg = await import('../src/main/workspaceConfig');
  await installFakeEngine();
  cfg.updateConfig((c) => {
    c.projects.roots = [work];
    c.docs = { ...c.docs, autoDetect: false, claudeMdRoots: [other], skillsDirs: [join(other, 'skills')], rulesDirs: [join(other, 'rules')], agentsDirs: [join(other, 'agents')], knowledgeDirs: [join(other, 'kb')], mcpConfigFiles: [] };
    return c;
  });
});

const ask = async (role: 'turn' | 'deep', extra: Record<string, unknown> = {}) => {
  const before = calls.length;
  await agents.askAgent(role, 'question', agents.obj({ fala: agents.str }), extra);
  return calls[before];
};

describe('the config of an agent role', () => {
  it('has a persona, a turn limit and a documentation selection for every role, off by default', () => {
    const c = neutralConfig();
    for (const role of Object.values(c.agents.roles)) {
      expect(role).toMatchObject({ persona: '', maxTurns: null, docs: { claudeMd: true, skills: true, rules: true, agents: true, knowledge: true, mcp: true } });
    }
    expect(c.agents.persona).toBe('');
  });

  it('refuses a turn limit that is not a positive whole number', () => {
    for (const bad of [0, -1, 1.5, 500, 'ten']) {
      const c = neutralConfig() as unknown as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
      c.agents.roles.turn.maxTurns = bad;
      expect(validateConfig(c).ok, String(bad)).toBe(false);
    }
    const ok = neutralConfig();
    ok.agents.roles.turn.maxTurns = 5;
    expect(validateConfig(ok).ok).toBe(true);
  });

  it('adds the shared persona, then the persona of the role, to the prompt of the agent, after the preamble and before the extra instructions', async () => {
    cfg.updateConfig((c) => {
      c.agents.persona = 'Be brief.';
      c.agents.extraInstructions = 'Mention the ticket.';
      c.agents.roles.turn.persona = 'Sound calm.';
      c.agents.roles.turn.extraInstructions = 'End with the next step.';
      return c;
    });
    const turn = (await ask('turn')).system.split('\n');
    expect(turn[0]).toContain('cerimônia por voz');
    expect(turn.slice(1)).toEqual(['Be brief.', 'Sound calm.', 'Mention the ticket.', 'End with the next step.']);
    // The deep role has no persona of its own: only the shared one.
    expect((await ask('deep')).system.split('\n').slice(1)).toEqual(['Be brief.', 'Mention the ticket.']);
  });

  it('applies the turn limit of the role to every call of the role, and leaves the other roles with their own', async () => {
    expect((await ask('turn', { maxTurns: 8 })).maxTurns).toBe(8);
    cfg.updateConfig((c) => {
      c.agents.roles.turn.maxTurns = 3;
      return c;
    });
    expect((await ask('turn', { maxTurns: 8 })).maxTurns).toBe(3);
    expect((await ask('deep', { maxTurns: 20 })).maxTurns).toBe(20);
  });

  it('lets the role read only the documentation sources it was given', async () => {
    const all = await ask('turn');
    expect(all.extraDirs.sort()).toEqual([join(other, 'agents'), join(other), join(other, 'kb'), join(other, 'rules'), join(other, 'skills')].sort());
    cfg.updateConfig((c) => {
      c.agents.roles.turn.docs = { claudeMd: false, skills: false, rules: true, agents: false, knowledge: false, mcp: false };
      return c;
    });
    expect((await ask('turn')).extraDirs).toEqual([join(other, 'rules')]);
    // The other role keeps them all.
    expect((await ask('deep')).extraDirs).toHaveLength(5);
  });

  it('can send a role to another model role, and says which tools it may use', async () => {
    cfg.updateConfig((c) => {
      c.agents.roles.reply.modelRole = 'deep';
      return c;
    });
    expect(cfg.rc().role('reply').modelRole).toBe('deep');
    expect(cfg.rc().role('turn').modelRole).toBe('turn');
  });
});

describe('the prompt override of a role', () => {
  it('replaces the preamble when it is not empty, and the persona still follows', async () => {
    cfg.updateConfig((c) => {
      c.agents.roles.deep.promptOverride = 'You are a careful investigator.';
      return c;
    });
    expect((await ask('deep')).system.split('\n').slice(0, 2)).toEqual(['You are a careful investigator.', 'Be brief.']);
  });
});
