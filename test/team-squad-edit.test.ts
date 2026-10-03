import { describe, expect, it } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { membersOf, squadOf } from '../src/shared/config/squads';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { applySquad, blankSquad, draftOfSquad, hasOwnFlow, movingAgents, normalizePrefix, squadIssues, squadProblems, withLabel } from '../src/renderer/src/screens/team/squadEdit';

const base = (): WorkspaceConfig => {
  const c = applyTemplate(neutralConfig(), agentFlow);
  c.projects.repos = [
    { id: 'api', path: '/tmp/api', remoteUrl: null, vcsId: null, projectPath: null },
    { id: 'web', path: '/tmp/web', remoteUrl: null, vcsId: null, projectPath: null },
  ];
  return c;
};
const draft = (over: Partial<ReturnType<typeof blankSquad>> = {}) => ({ ...blankSquad(), id: 'backend', name: 'Backend', ...over });

describe('scope text', () => {
  it('normalizes a folder and a label', () => {
    expect(normalizePrefix(' ./services/billing/ ')).toBe('services/billing');
    expect(normalizePrefix('/')).toBe('');
    expect(withLabel(['Bug'], ' bug ')).toEqual(['Bug']);
    expect(withLabel(['Bug'], '  ')).toEqual(['Bug']);
    expect(withLabel(['Bug'], 'api')).toEqual(['Bug', 'api']);
  });
});

describe('the problems of a squad draft', () => {
  it('asks for a name and a valid free id, a folder with a repository, a liaison from the members', () => {
    const c = base();
    expect(squadProblems(c, blankSquad(), true).map((p) => p.key)).toEqual(['ui.squads.err.name', 'ui.squads.err.idShape']);
    expect(squadProblems(c, draft({ paths: [{ repo: 'api', prefix: ' / ' }] }), true).map((p) => p.key)).toEqual(['ui.squads.err.path']);
    expect(squadProblems(c, draft({ liaison: 'qa' }), true).map((p) => p.key)).toEqual(['ui.squads.err.liaisonMember']);
    expect(squadProblems(c, draft({ label: 'a, b' }), true).map((p) => p.key)).toEqual(['ui.squads.err.label']);
    expect(squadProblems(c, draft(), true)).toEqual([]);
  });

  it('refuses a taken id only for a new squad', () => {
    const c = applySquad(base(), draft({ members: ['developer'], liaison: 'developer' }), true);
    expect(squadProblems(c, draft(), true).map((p) => p.key)).toEqual(['ui.squads.err.idTaken']);
    expect(squadProblems(c, draftOfSquad(c, squadOf(c, 'backend')!), false)).toEqual([]);
  });
});

describe('applying a squad draft', () => {
  it('adds the squad with its scope, members and liaison, and the result validates', () => {
    const c = applySquad(base(), draft({ mission: ' Ships the API ', label: ' squad:backend ', repos: ['api'], labels: ['backend'], paths: [{ repo: 'api', prefix: './svc/' }], members: ['developer', 'qa'], liaison: 'developer' }), true);
    expect(squadOf(c, 'backend')).toMatchObject({ mission: 'Ships the API', label: 'squad:backend', liaison: 'developer', autonomy: true, scope: { repos: ['api'], labels: ['backend'], paths: [{ repo: 'api', prefix: 'svc' }], unclaimed: false } });
    expect(membersOf(c, 'backend').map((a) => a.id)).toEqual(['developer', 'qa']);
    expect(validateConfig(c).errors).toEqual([]);
  });

  it('moves agents in and out, and a liaison that leaves stops being it', () => {
    let c = applySquad(base(), draft({ members: ['developer', 'qa'], liaison: 'developer' }), true);
    c = applySquad(c, { ...draftOfSquad(c, squadOf(c, 'backend')!), members: ['qa', 'tech-lead'], liaison: 'developer' }, false);
    expect(membersOf(c, 'backend').map((a) => a.id).sort()).toEqual(['qa', 'tech-lead']);
    expect(squadOf(c, 'backend')?.liaison).toBeNull();
  });

  it('takes an agent from another squad and says so', () => {
    const c = applySquad(base(), draft({ members: ['developer'], liaison: 'developer' }), true);
    const second = draft({ id: 'web', name: 'Web', members: ['developer', 'qa'], liaison: 'qa' });
    expect(movingAgents(c, second)).toEqual([{ agent: 'developer', from: 'backend' }]);
    const next = applySquad(c, second, true);
    expect(membersOf(next, 'backend')).toEqual([]);
    expect(squadOf(next, 'backend')?.liaison).toBeNull();
  });

  it('refuses a taken id', () => {
    const c = applySquad(base(), draft(), true);
    expect(() => applySquad(c, draft(), true)).toThrow();
  });
});

describe('the checks of a squad over its draft', () => {
  it('says a squad with members and no liaison is refused, and one with a liaison is quiet', () => {
    const c = base();
    expect(squadIssues(c, draft({ members: ['developer'] }), true).map((i) => i.code)).toContain('no-liaison');
    expect(squadIssues(c, draft({ members: ['developer'], liaison: 'developer', repos: ['api'] }), true).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('warns about an empty scope, an empty squad and a scope that overlaps', () => {
    let c = base();
    expect(squadIssues(c, draft(), true).map((i) => i.code).sort()).toEqual(['scope-empty', 'squad-empty']);
    c = applySquad(c, draft({ members: ['developer'], liaison: 'developer', repos: ['api'] }), true);
    expect(squadIssues(c, draft({ id: 'web', name: 'Web', repos: ['api'], members: ['qa'], liaison: 'qa' }), true).map((i) => i.code)).toContain('scope-overlap');
  });

  it('knows whether a squad has a flow of its own', () => {
    const c = applySquad(base(), draft(), true);
    expect(hasOwnFlow(c, 'backend')).toBe(false);
    c.devCycle.flows = { backend: [] };
    expect(hasOwnFlow(c, 'backend')).toBe(true);
  });
});
