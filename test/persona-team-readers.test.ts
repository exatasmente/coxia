// The persona takes no part in the cycle (rule 2): everything that already keeps a draft out of it keeps the persona out too. This walks the readers of the team with a persona
// in it, and scans the source so that a new reader of `isDraft(`, `outOfCycle(` or `workingTeam(` has to be classified here before the suite is green.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { adjustable, assistContext } from '../src/main/agentAssist-core';
import { offeredStages } from '../src/shared/agentAssist';
import { applyTemplate, builtInTemplate } from '../src/shared/cycles';
import { mergeTemplateTeam, parseTemplate, templateFromConfig } from '../src/shared/cycles/apply';
import { effectiveTeam, liaisonFor, membersOf, newSquad, turnTarget } from '../src/shared/config/squads';
import { newAgent, recommendations, stageAgent, workingTeam } from '../src/shared/config/team';
import type { AgentDef, StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { mentionableIds } from '../src/shared/forum';
import { chatAgents, mentionChoices } from '../src/shared/forumView';
import { checkFlow } from '../src/shared/runs/flowCheck';
import { checkSquads } from '../src/shared/runs/squadCheck';
import { agentThreadId } from '../src/shared/forum';

const stage = (id: string, over: Partial<StageDef> = {}): StageDef => ({ id, label: id, match: [], kind: 'development', rank: 1, type: 'work', ...over });
const STAGES: StageDef[] = [stage('plan', { rank: 1, produces: ['2_PLAN.md'] }), stage('gate', { rank: 2, type: 'gate' }), stage('code', { rank: 3, next: null, agentId: 'persona-id' })];

// A persona that lists stages, a squad and a way to turn, as a hand-edited file could: the readers must leave it out whatever it lists (validation refuses such a file, but a reader may meet one).
const loud = (over: Partial<AgentDef> & Pick<AgentDef, 'id'>): AgentDef => newAgent({ stages: ['plan', 'code'], squad: 'core', turnsTo: 'dev', autonomous: true, ...over });
const persona = loud({ id: 'persona-id', name: 'Me', kind: 'persona' });
const copy = loud({ id: 'persona-copy', name: 'Me (test)', kind: 'persona', draft: true });
const draft = loud({ id: 'trial', name: 'Trial', draft: true });
const dev = newAgent({ id: 'dev', name: 'Dev', stages: ['plan', 'code'], squad: 'core' });
// A persona whose id is one the app recommends commands for.
const qa = newAgent({ id: 'qa', name: 'Me', kind: 'persona', tracker: 'none', shell: 'none' });

function config(extra: AgentDef[]): WorkspaceConfig {
  const c = neutralConfig();
  c.devCycle.stages = STAGES;
  c.squads = [newSquad({ id: 'core', name: 'Core', liaison: 'persona-id' })];
  return { ...c, agents: { ...c.agents, team: [...c.agents.team, dev, ...extra] } };
}

const ids = (list: readonly { id: string }[]): string[] => list.map((a) => a.id);

describe('the readers of the team leave the persona out', () => {
  const c = config([persona, copy, draft, qa]);

  it('workingTeam holds neither the persona, its test copy nor a draft', () => {
    expect(ids(workingTeam(c.agents.team))).toEqual([...ids(neutralConfig().agents.team), 'dev']);
  });

  it('stageAgent never returns the persona: not for a stage that names it, not for a stage it lists', () => {
    expect(stageAgent(c.agents.team, STAGES, 'code')?.id).toBe('dev');
    expect(stageAgent(c.agents.team, STAGES, 'plan')?.id).toBe('dev');
    const alone = config([persona]);
    alone.agents.team = alone.agents.team.filter((a) => a.id !== 'dev');
    expect(stageAgent(alone.agents.team, STAGES, 'code')).toBeNull();
    expect(stageAgent(alone.agents.team, STAGES, 'plan')).toBeNull();
  });

  it('a squad has no persona as member, liaison or link of a chain of questions', () => {
    expect(ids(membersOf(c, 'core'))).toEqual(['dev']);
    expect(ids(effectiveTeam(c))).not.toContain('persona-id');
    expect(liaisonFor(c, dev)).toBeNull();
    expect(turnTarget(c, { ...dev, turnsTo: 'persona-id' })).toBeNull();
  });

  it('no permission is recommended for a persona, whatever its id', () => {
    expect(recommendations(c, true).map((r) => r.id)).not.toContain('qa');
  });

  it('a stage that names the persona is not taken, and the flow check says the agent is not in the team', () => {
    expect(offeredStages(c).map((s) => s.id)).toContain('code');
    const issues = checkFlow({ stages: STAGES, team: c.agents.team });
    expect(issues.some((i) => i.code === 'agent-unknown' && i.stage === 'code')).toBe(true);
    expect(checkSquads({ squads: c.squads ?? [], team: c.agents.team, stages: STAGES }).some((i) => i.agent === 'persona-id')).toBe(false);
  });

  it('@ resolves no persona, not even in its own thread, and a draft only in its own', () => {
    expect(mentionableIds(c.agents.team)).not.toContain('persona-id');
    expect(mentionableIds(c.agents.team, agentThreadId('persona-id'))).not.toContain('persona-id');
    expect(mentionableIds(c.agents.team, agentThreadId('persona-copy'))).not.toContain('persona-copy');
    expect(mentionableIds(c.agents.team, agentThreadId('trial'))).toContain('trial');
    expect(mentionableIds(c.agents.team)).not.toContain('trial');
  });

  it('the forum offers no direct conversation with the persona and completes no @ for it', () => {
    expect(ids(chatAgents(c.agents.team))).not.toContain('persona-id');
    expect(ids(chatAgents(c.agents.team))).toContain('dev');
    expect(ids(mentionChoices(c.agents.team, agentThreadId('persona-id')))).not.toContain('persona-id');
  });

  it('a template made from the workspace has no persona, and one that brings a persona does not add it', () => {
    const made = templateFromConfig(c, { id: 'mine', name: 'Mine', description: '' });
    expect(ids(made.team ?? [])).toEqual(['dev']);
    const merged = mergeTemplateTeam(neutralConfig().agents.team, [persona, dev], { stages: STAGES, flows: undefined });
    expect(ids(merged)).toContain('dev');
    expect(ids(merged)).not.toContain('persona-id');
  });

  it('a template file that carries a persona kind is read as an ordinary agent, with a warning', () => {
    const plain = config([]);
    plain.devCycle.stages = STAGES.map(({ agentId: _a, ...rest }) => rest);
    const base = templateFromConfig(plain, { id: 'mine', name: 'Mine', description: '' });
    const file = { ...base, team: [{ ...dev, id: 'helper' }, { id: 'sneaky', name: 'Sneaky', kind: 'persona' }] };
    const r = parseTemplate(file);
    expect(r.errors).toEqual([]);
    expect(r.template?.team?.find((a) => a.id === 'sneaky')).not.toHaveProperty('kind');
    expect(r.warnings.map((w) => w.path)).toContain('template.team[sneaky].kind');
    expect(r.warnings.map((w) => w.path)).not.toContain('template.team[helper].kind');
  });

  it('applying a built-in template over a workspace with a persona keeps the persona and gives it no stage', () => {
    const applied = applyTemplate(neutralConfig(), builtInTemplate('agent-flow') ?? (undefined as never));
    expect(applied.agents.team.some((a) => a.kind === 'persona')).toBe(false);
    const kept = applyTemplate({ ...neutralConfig(), agents: { ...neutralConfig().agents, team: [...neutralConfig().agents.team, newAgent({ id: 'persona-id', name: 'Me', kind: 'persona' })] } }, builtInTemplate('agent-flow') ?? (undefined as never));
    expect(kept.agents.team.find((a) => a.id === 'persona-id')).toMatchObject({ kind: 'persona', stages: [] });
  });

  it('the creator is told nothing about the persona and never adjusts it', () => {
    expect(ids(assistContext(c, true).agents)).toEqual([...ids(neutralConfig().agents.team), 'dev']);
    expect(ids(assistContext(c, true).agents)).not.toContain('persona-id');
    expect(adjustable(c, 'persona-id')).toBeNull();
    expect(adjustable(c, 'persona-copy')).toBeNull();
    expect(adjustable(c, 'dev')?.id).toBe('dev');
  });
});

// ---- the guard of class D ------------------------------------------------------------------------------------------------------------------------
// Every file of src/ that reads the team through `isDraft(`, `outOfCycle(` or `workingTeam(`, with how it keeps the persona out:
//   through: it reads `workingTeam`, which already leaves the persona out (class A of the plan);
//   direct: it tests the mark itself and was edited to test the persona too (class B);
//   both: the two.
// A new reader has to be added here, with its class, and the persona of the test above walked through it.
const READERS: Record<string, 'through' | 'direct' | 'both'> = {
  'src/main/agentAssist-core.ts': 'both',
  'src/main/agentAssist.ts': 'direct',
  'src/main/forum.ts': 'both',
  'src/main/mentions/answer.ts': 'both',
  'src/main/persona/assist.ts': 'direct',
  'src/main/runner/executor.ts': 'through',
  'src/main/runner/service.ts': 'through',
  'src/main/workspaceConfig.ts': 'through',
  'src/renderer/src/screens/team/TeamSection.tsx': 'direct',
  'src/renderer/src/screens/team/agentEdit.ts': 'both',
  'src/renderer/src/screens/team/flowEdit.ts': 'through',
  'src/renderer/src/screens/team/squadEdit.ts': 'through',
  'src/shared/agentAssist.ts': 'through',
  'src/shared/config/squads.ts': 'through',
  'src/shared/config/team.ts': 'both',
  'src/shared/config/validate.ts': 'direct',
  'src/shared/cycles/apply.ts': 'direct',
  'src/shared/forum.ts': 'direct',
  'src/shared/forumView.ts': 'direct',
  'src/shared/runs/flowCheck.ts': 'both',
  'src/shared/runs/squadCheck.ts': 'through',
};

describe('the readers of the team, scanned in the source (class D)', () => {
  const ROOT = join(import.meta.dirname, '..');
  const files = readdirSync(join(ROOT, 'src'), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f)).map((f) => `src/${f}`);
  const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');
  const callers = files.filter((f) => /\b(isDraft|outOfCycle|workingTeam)\(/.test(read(f))).sort();

  it('is exactly the classified set: a new reader has to be classified before the suite is green', () => {
    expect(callers).toEqual(Object.keys(READERS).sort());
  });

  it('a "through" reader tests no mark of its own, and a "direct" one reads no working team', () => {
    for (const [file, how] of Object.entries(READERS)) {
      if (file === 'src/shared/config/team.ts') continue;
      const text = read(file);
      if (how === 'through') expect(/\b(isDraft|outOfCycle)\(/.test(text), file).toBe(false);
      if (how === 'direct') expect(/\bworkingTeam\(/.test(text), file).toBe(false);
    }
  });

  it('a direct reader of the draft mark also tests for the persona', () => {
    for (const [file, how] of Object.entries(READERS)) {
      if (how === 'through' || file === 'src/shared/config/team.ts' || file === 'src/shared/config/validate.ts' || file === 'src/shared/runs/flowCheck.ts') continue;
      expect(/\b(outOfCycle|isPersona)\b/.test(read(file)), file).toBe(true);
    }
  });
});
