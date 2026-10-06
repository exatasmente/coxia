import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { docsListsOf, withDocsSources } from '../src/shared/harness/sources';

// Settings › Documentation saves the whole configuration (`config:save` replaces it), so what it saves is the configuration as it is at that moment with only the
// lists of extra sources replaced; a snapshot from when the screen opened must never be what gets written.

describe('saving the extra sources of the documentation', () => {
  it('replaces only the lists: the team and the flows changed since the screen opened are kept', () => {
    const opened = neutralConfig();
    const lists = docsListsOf(opened);
    lists.rulesDirs = [...lists.rulesDirs, 'notes/rules'];

    // meanwhile, on the same screen: an agent was added and a docs flow applied
    const now = neutralConfig();
    now.agents.team = [...now.agents.team, newAgent({ id: 'added-later' })];
    now.devCycle = { ...now.devCycle, flows: { ...now.devCycle.flows, docs: [] } };
    now.docs.autoDetect = !opened.docs.autoDetect;
    now.docs.specsDir = 'elsewhere/specs';

    const saved = withDocsSources(now, lists);
    expect(saved.agents.team.map((a) => a.id)).toContain('added-later');
    expect(saved.devCycle.flows).toHaveProperty('docs');
    expect(saved.docs.rulesDirs).toEqual(lists.rulesDirs);
    expect(saved.docs.autoDetect).toBe(now.docs.autoDetect);
    expect(saved.docs.specsDir).toBe('elsewhere/specs');
    // what the stale snapshot would have written
    expect({ ...opened, docs: { ...opened.docs, ...lists } }.agents.team.map((a) => a.id)).not.toContain('added-later');
  });

  it('touches no field outside docs and no input', () => {
    const now = neutralConfig();
    const lists = docsListsOf(now);
    lists.skillsDirs = ['a', 'b'];
    const before = structuredClone(now);
    const saved = withDocsSources(now, lists);
    expect(now).toEqual(before);
    expect({ ...saved, docs: now.docs }).toEqual(now);
    expect(saved.docs.skillsDirs).toEqual(['a', 'b']);
    // a copy: editing the saved list does not edit the screen's
    saved.docs.skillsDirs.push('c');
    expect(lists.skillsDirs).toEqual(['a', 'b']);
  });

  it('can empty a list, and ignores a key that is not a list of sources', () => {
    const now = neutralConfig();
    now.docs.mcpConfigFiles = ['.mcp.json'];
    const lists = { ...docsListsOf(now), mcpConfigFiles: [], autoDetect: false, specsDir: 'x' } as ReturnType<typeof docsListsOf>;
    const saved = withDocsSources(now, lists);
    expect(saved.docs.mcpConfigFiles).toEqual([]);
    expect(saved.docs.autoDetect).toBe(now.docs.autoDetect);
    expect(saved.docs.specsDir).toBe(now.docs.specsDir);
  });
});
