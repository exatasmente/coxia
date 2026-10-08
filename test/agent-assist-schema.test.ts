import { describe, expect, it } from 'vitest';
import {
  ASSIST_FIELDS,
  ASSIST_LIMITS,
  ASSIST_ROUND_SCHEMA,
  MINIMUM_SETTINGS,
  assistReviewSchema,
  clampSettings,
  isAboveMinimum,
  isSkipped,
  readAssistDraft,
  readQuestions,
  shellsOffered,
  type AssistOffers,
  type AssistSettings,
} from '../src/shared/agentAssist';
import type { AgentToolsConfig } from '../src/shared/config/types';
import { slugOf, uniqueId } from '../src/shared/config/team';
import { redact } from '../src/main/errorlog-core';
import * as editor from '../src/renderer/src/screens/team/agentEdit';

// What the agent assistant reads from a model: the questions, the draft and the settings. Pure functions over `unknown`: nothing here reaches a model.

const WORKSPACE_TOOLS: AgentToolsConfig = { files: true, skills: true, trackerMcp: false, trackerMcpServer: '', vcsCli: true, subagents: false };

const offers = (over: Partial<AssistOffers> = {}): AssistOffers => ({
  sandbox: true,
  permission: ['read', 'worktree'],
  stages: ['refine', 'plan', 'implement'],
  squads: ['payments'],
  turnsTo: ['tech-lead', 'qa'],
  workspaceTools: WORKSPACE_TOOLS,
  ...over,
});

const base = (over: Partial<AssistSettings> = {}): AssistSettings => ({ ...MINIMUM_SETTINGS, ...over });

const choice = (over: Record<string, unknown> = {}) => ({ text: 'Which repositories?', kind: 'single', options: ['api', 'web'], why: 'It sets what the agent reads.', ...over });

describe('readQuestions', () => {
  it('keeps the valid questions and drops the ones out of shape without losing the rest', () => {
    const read = readQuestions([
      { text: 'What should it never touch?', kind: 'open', options: [], why: 'A limit.' },
      { text: '', kind: 'open', options: [], why: 'no text' },
      { text: 'Unknown kind', kind: 'ranking', options: ['a', 'b'], why: '' },
      choice({ text: 'One option only', options: ['a'] }),
      'not an object',
      null,
      choice(),
      { kind: 'open' },
    ]);
    expect(read.map((q) => q.text)).toEqual(['What should it never touch?', 'Which repositories?']);
  });

  it('numbers the questions q1, q2... by position among the valid ones, whatever ids the model wrote', () => {
    const read = readQuestions([{ id: 'q1', text: 'Bad', kind: 'open' }, { id: 'q1', text: 'Good', kind: 'open' }, { id: 'q1', ...choice() }]);
    expect(read.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('lets at most six through, and does not enforce the minimum of three', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ text: `Question ${i}`, kind: 'open' }));
    expect(readQuestions(eight)).toHaveLength(6);
    expect(readQuestions(eight.slice(0, 1))).toHaveLength(1);
    expect(readQuestions(eight.slice(0, 2))).toHaveLength(2);
  });

  it('returns nothing for an answer that is not a list', () => {
    for (const raw of [undefined, null, 'questions', 7, {}, { questions: [] }]) expect(readQuestions(raw)).toEqual([]);
  });

  it('trims the options to 120 characters, drops the repeated and the empty, and keeps six at most', () => {
    const long = 'x'.repeat(300);
    const [q] = readQuestions([choice({ kind: 'multi', options: [long, ' api ', 'API', 'api', '', '  ', 'b', 'c', 'd', 'e', 'f', 'g'] })]);
    expect(q.options[0]).toHaveLength(ASSIST_LIMITS.option);
    expect(q.options).toEqual(['x'.repeat(120), 'api', 'b', 'c', 'd', 'e']);
  });

  it('drops a choice that is left with fewer than two useful options', () => {
    expect(readQuestions([choice({ options: ['same', 'Same', ' '] }), choice({ kind: 'multi', options: [] }), choice({ options: 'api, web' })])).toEqual([]);
  });

  it('gives an open question no options and cuts the text and the reason', () => {
    const [q] = readQuestions([{ text: 'T'.repeat(900), kind: 'open', options: ['a', 'b'], why: 'W'.repeat(500) }]);
    expect(q.options).toEqual([]);
    expect(q.text).toHaveLength(ASSIST_LIMITS.question);
    expect(q.why).toHaveLength(ASSIST_LIMITS.why);
  });

  it('masks a secret the model repeated, through the cleaner it is given', () => {
    const key = 'sk-ant-' + 'a1b2c3d4'.repeat(4);
    const [q] = readQuestions([choice({ text: `Use ${key}?`, options: [`${key} please`, 'no'], why: `from ${key}` })], redact);
    expect(JSON.stringify(q)).not.toContain(key);
    expect(q.text).toContain('[key]');
  });
});

describe('readAssistDraft', () => {
  it('cuts the three texts to the limits of the editor: 80, 1000 and 4000', () => {
    const draft = readAssistDraft({ name: 'N'.repeat(200), job: 'J'.repeat(2000), instructions: 'I'.repeat(9000) });
    expect(draft.name).toHaveLength(80);
    expect(draft.job).toHaveLength(1000);
    expect(draft.instructions).toHaveLength(4000);
  });

  it('masks a secret, through the cleaner it is given, before it reaches the screen', () => {
    const key = 'ghp_' + 'Ab12Cd34'.repeat(4);
    const draft = readAssistDraft({ name: 'Reviewer', job: 'Reads', instructions: `Use token ${key} to log in.` }, undefined, redact);
    expect(draft.instructions).not.toContain(key);
    expect(draft.instructions).toContain('[key]');
  });

  it('keeps what the draft had for a text the model left empty or did not send', () => {
    const before = { name: 'Reviewer', job: 'Reviews', instructions: 'Review the change.' };
    expect(readAssistDraft({ name: '  ', job: 3, instructions: '' }, before)).toEqual(before);
    expect(readAssistDraft({ name: 'Auditor' }, before)).toEqual({ ...before, name: 'Auditor' });
    expect(readAssistDraft({}, undefined)).toEqual({ name: '', job: '', instructions: '' });
  });

  it('does not throw on input that is not an object', () => {
    for (const raw of [undefined, null, 'draft', 12, [], true]) expect(readAssistDraft(raw, { name: 'A', job: 'B', instructions: 'C' })).toEqual({ name: 'A', job: 'B', instructions: 'C' });
  });
});

describe('isSkipped', () => {
  it('is true only when nothing was picked or written', () => {
    expect(isSkipped({ picked: [], other: '', text: '' })).toBe(true);
    expect(isSkipped({ picked: [], other: '  ', text: ' ' })).toBe(true);
    expect(isSkipped({ picked: ['api'], other: '', text: '' })).toBe(false);
    expect(isSkipped({ picked: [], other: 'something else', text: '' })).toBe(false);
    expect(isSkipped({ picked: [], other: '', text: 'free text' })).toBe(false);
  });
});

describe('clampSettings', () => {
  const review = (over: Record<string, unknown>) => over;
  const reasoned = (value: unknown, reason = 'because the work needs it') => ({ value, reason });

  it('leaves the base for input that is not an object, and never throws', () => {
    for (const raw of [undefined, null, 'worktree', 42, true, [], [reasoned('worktree')]]) {
      const out = clampSettings(raw, offers(), base());
      expect(out.settings).toEqual(MINIMUM_SETTINGS);
      expect(out.reasons).toEqual({});
    }
  });

  it('has the seven fields and nothing else, whatever the model sends', () => {
    const out = clampSettings(
      review({ autonomous: true, allowedCommands: ['git:*'], model: { role: null, provider: 'x', model: 'y' }, id: 'taken', system: true, draft: false, permission: reasoned('worktree') }),
      offers(),
      base(),
    );
    expect(Object.keys(out.settings).sort()).toEqual([...ASSIST_FIELDS].sort());
    expect(out.settings.permission).toBe('worktree');
  });

  describe('permission', () => {
    it('takes read and worktree with a reason', () => {
      expect(clampSettings(review({ permission: reasoned('worktree') }), offers(), base()).settings.permission).toBe('worktree');
      expect(clampSettings(review({ permission: reasoned('read') }), offers(), base({ permission: 'worktree', shell: 'allowlist' })).settings.permission).toBe('read');
    });

    it('refuses any other value, and one the editor does not offer', () => {
      for (const value of ['admin', 'write', 'WORKTREE', '', null, 3, ['worktree']]) expect(clampSettings(review({ permission: reasoned(value) }), offers(), base()).settings.permission).toBe('read');
      expect(clampSettings(review({ permission: reasoned('worktree') }), offers({ permission: ['read'] }), base()).settings.permission).toBe('read');
    });

    it('goes back to the minimum without a reason', () => {
      for (const reason of ['', '   ', undefined, 5]) expect(clampSettings(review({ permission: { value: 'worktree', reason } }), offers(), base()).settings.permission).toBe('read');
    });
  });

  describe('tracker', () => {
    it('takes none and read, with a reason for read', () => {
      expect(clampSettings(review({ tracker: reasoned('read') }), offers(), base()).settings.tracker).toBe('read');
      expect(clampSettings(review({ tracker: { value: 'read', reason: '' } }), offers(), base()).settings.tracker).toBe('none');
      expect(clampSettings(review({ tracker: reasoned('write') }), offers(), base()).settings.tracker).toBe('none');
    });
  });

  describe('shell', () => {
    it('takes sandbox only where one works', () => {
      expect(clampSettings(review({ shell: reasoned('sandbox') }), offers({ sandbox: true }), base()).settings.shell).toBe('sandbox');
      expect(clampSettings(review({ shell: reasoned('sandbox') }), offers({ sandbox: false }), base()).settings.shell).toBe('none');
    });

    it('refuses allowlist for an agent that only reads', () => {
      expect(clampSettings(review({ shell: reasoned('allowlist') }), offers(), base()).settings.shell).toBe('none');
    });

    it('keeps allowlist when the same review gives the agent the worktree permission', () => {
      const out = clampSettings(review({ permission: reasoned('worktree'), shell: reasoned('allowlist') }), offers(), base());
      expect(out.settings).toMatchObject({ permission: 'worktree', shell: 'allowlist' });
    });

    it('refuses allowlist when the permission that comes with it was refused for want of a reason', () => {
      const out = clampSettings(review({ permission: { value: 'worktree', reason: '' }, shell: reasoned('allowlist') }), offers(), base());
      expect(out.settings).toMatchObject({ permission: 'read', shell: 'none' });
    });

    it('never takes host from a model', () => {
      expect(clampSettings(review({ shell: reasoned('host') }), offers(), base()).settings.shell).toBe('none');
      expect(clampSettings(review({ permission: reasoned('worktree'), shell: reasoned('host') }), offers(), base()).settings.shell).toBe('none');
      expect(clampSettings(review({ shell: reasoned('Host') }), offers(), base({ shell: 'sandbox' })).settings.shell).toBe('sandbox');
    });

    it('keeps the host an agent already had, whether the model leaves it alone or repeats it', () => {
      const had = base({ permission: 'worktree', shell: 'host' });
      expect(clampSettings({}, offers(), had).settings.shell).toBe('host');
      const repeated = clampSettings(review({ shell: { value: 'host', reason: '' } }), offers(), had);
      expect(repeated.settings.shell).toBe('host');
      expect(repeated.reasons.shell).toBeUndefined();
    });

    it('lets a model take the host away from an agent, with a reason', () => {
      const had = base({ permission: 'worktree', shell: 'host' });
      expect(clampSettings(review({ shell: reasoned('none') }), offers(), had).settings.shell).toBe('none');
      expect(clampSettings(review({ shell: { value: 'none', reason: '' } }), offers(), had).settings.shell).toBe('host');
    });

    it('drops allowlist to none when the permission is lowered, as the editor does', () => {
      const had = base({ permission: 'worktree', shell: 'allowlist' });
      expect(clampSettings(review({ permission: reasoned('read') }), offers(), had).settings).toMatchObject({ permission: 'read', shell: 'none' });
    });

    it('lists what a model may pick: never host, sandbox only where it works, allowlist only for a writer', () => {
      expect(shellsOffered({ sandbox: true }, 'read')).toEqual(['none', 'sandbox']);
      expect(shellsOffered({ sandbox: false }, 'read')).toEqual(['none']);
      expect(shellsOffered({ sandbox: true }, 'worktree')).toEqual(['none', 'sandbox', 'allowlist']);
    });
  });

  describe('tools', () => {
    it('turns the four switches on or off over the tools of the workspace', () => {
      const out = clampSettings(review({ tools: { files: false, skills: null, vcsCli: null, subagents: true, reason: 'It only talks.' } }), offers(), base());
      expect(out.settings.tools).toEqual({ ...WORKSPACE_TOOLS, files: false, subagents: true });
      expect(out.reasons.tools).toBe('It only talks.');
    });

    it('is null when what comes out is what the workspace has', () => {
      const out = clampSettings(review({ tools: { files: true, skills: true, vcsCli: true, subagents: false, reason: 'same' } }), offers(), base());
      expect(out.settings.tools).toBeNull();
      expect(out.reasons.tools).toBeUndefined();
    });

    it('has no opinion when every switch is null', () => {
      const own = { ...WORKSPACE_TOOLS, files: false };
      expect(clampSettings(review({ tools: { files: null, skills: null, vcsCli: null, subagents: null, reason: 'no change' } }), offers(), base({ tools: own })).settings.tools).toEqual(own);
    });

    it('never takes the tracker tools from the model: they come from the workspace, or from the agent', () => {
      const sent = { files: false, skills: null, vcsCli: null, subagents: null, trackerMcp: true, trackerMcpServer: 'issues', reason: 'x' };
      const fromWorkspace = clampSettings(review({ tools: sent }), offers(), base()).settings.tools;
      expect(fromWorkspace).toMatchObject({ files: false, trackerMcp: false, trackerMcpServer: '' });
      const had = { ...WORKSPACE_TOOLS, trackerMcp: true, trackerMcpServer: 'tracker' };
      expect(clampSettings(review({ tools: sent }), offers(), base({ tools: had })).settings.tools).toMatchObject({ files: false, trackerMcp: true, trackerMcpServer: 'tracker' });
    });

    it('goes back to the minimum without a reason', () => {
      expect(clampSettings(review({ tools: { files: false, skills: null, vcsCli: null, subagents: null, reason: '' } }), offers(), base()).settings.tools).toBeNull();
    });

    it('ignores a value that is not a boolean', () => {
      expect(clampSettings(review({ tools: { files: 'no', skills: 0, vcsCli: [], subagents: undefined, reason: 'x' } }), offers(), base()).settings.tools).toBeNull();
    });
  });

  describe('stages', () => {
    it('keeps the ids that exist, once each, and drops the rest', () => {
      const out = clampSettings(review({ stages: { ids: ['plan', 'nope', 'plan', 'implement', 3, null], reason: 'It plans.' } }), offers(), base());
      expect(out.settings.stages).toEqual(['plan', 'implement']);
      expect(out.reasons.stages).toBe('It plans.');
    });

    it('does not read a list of ids that all fail to exist as a request to clear the stages', () => {
      const had = base({ stages: ['plan'] });
      expect(clampSettings(review({ stages: { ids: ['nope'], reason: 'x' } }), offers(), had).settings.stages).toEqual(['plan']);
      expect(clampSettings(review({ stages: { ids: [], reason: 'It no longer works a stage.' } }), offers(), had).settings.stages).toEqual([]);
    });

    it('is capped at sixty', () => {
      const many = Array.from({ length: 80 }, (_, i) => `s${i}`);
      const out = clampSettings(review({ stages: { ids: many, reason: 'all' } }), offers({ stages: many }), base());
      expect(out.settings.stages).toHaveLength(ASSIST_LIMITS.stages);
    });

    it('goes back to the minimum without a reason', () => {
      expect(clampSettings(review({ stages: { ids: ['plan'], reason: '' } }), offers(), base()).settings.stages).toEqual([]);
    });

    it('treats the same ids in another order as no change', () => {
      const out = clampSettings(review({ stages: { ids: ['plan', 'refine'], reason: '' } }), offers(), base({ stages: ['refine', 'plan'] }));
      expect(out.settings.stages).toEqual(['refine', 'plan']);
    });
  });

  describe('squad and turnsTo', () => {
    it('take an id the workspace and the team have', () => {
      const out = clampSettings(review({ squad: { id: 'payments', reason: 'It serves payments.' }, turnsTo: { id: 'tech-lead', reason: 'It asks the lead.' } }), offers(), base());
      expect(out.settings).toMatchObject({ squad: 'payments', turnsTo: 'tech-lead' });
    });

    it('refuse an id that does not exist', () => {
      const out = clampSettings(review({ squad: { id: 'ghosts', reason: 'x' }, turnsTo: { id: 'nobody', reason: 'x' } }), offers(), base());
      expect(out.settings).toMatchObject({ squad: null, turnsTo: null });
    });

    it('refuse the agent itself and a draft: they are not among the agents offered', () => {
      const out = clampSettings(review({ turnsTo: { id: 'reviewer-draft', reason: 'x' } }), offers({ turnsTo: ['tech-lead'] }), base());
      expect(out.settings.turnsTo).toBeNull();
      expect(clampSettings(review({ turnsTo: { id: 'reviewer', reason: 'x' } }), offers({ turnsTo: ['tech-lead'] }), base()).settings.turnsTo).toBeNull();
    });

    it('may move an agent out of its squad or to the person, with a reason', () => {
      const had = base({ squad: 'payments', turnsTo: 'qa' });
      expect(clampSettings(review({ squad: { id: null, reason: 'It serves everyone.' }, turnsTo: { id: null, reason: 'Ask the person.' } }), offers(), had).settings).toMatchObject({ squad: null, turnsTo: null });
      expect(clampSettings(review({ squad: { id: null, reason: '' } }), offers(), had).settings.squad).toBe('payments');
    });

    it('go back to the minimum without a reason', () => {
      expect(clampSettings(review({ squad: { id: 'payments', reason: '' }, turnsTo: { id: 'qa', reason: ' ' } }), offers(), base()).settings).toMatchObject({ squad: null, turnsTo: null });
    });
  });

  describe('reasons', () => {
    it('are cut to 300 characters and masked through the cleaner', () => {
      const key = 'glpat-' + 'Zz9Yy8Xx'.repeat(3);
      const out = clampSettings(review({ tracker: { value: 'read', reason: `${'r'.repeat(500)}` }, permission: { value: 'worktree', reason: `uses ${key}` } }), offers(), base(), { scrub: redact });
      expect(out.reasons.tracker).toHaveLength(ASSIST_LIMITS.reason);
      expect(out.reasons.permission).not.toContain(key);
    });

    it('exist only for the fields that moved', () => {
      const out = clampSettings(review({ permission: reasoned('read', 'stays'), tracker: reasoned('read', 'reads issues') }), offers(), base());
      expect(out.reasons).toEqual({ tracker: 'reads issues' });
    });
  });

  describe('adjusting an agent', () => {
    const had = base({ permission: 'worktree', tracker: 'read', shell: 'sandbox', stages: ['plan'], squad: 'payments', turnsTo: 'qa' });

    it('starts from the agent as it is and changes only what the review moves, with a reason', () => {
      const out = clampSettings(review({ tracker: reasoned('none', 'It no longer reads.') }), offers(), had);
      expect(out.settings).toEqual({ ...had, tracker: 'none' });
      expect(out.reasons).toEqual({ tracker: 'It no longer reads.' });
    });

    it('treats a value equal to the agent as unchanged, with or without a reason', () => {
      const out = clampSettings(review({ permission: reasoned('worktree'), shell: { value: 'sandbox', reason: '' } }), offers(), had);
      expect(out.settings).toEqual(had);
      expect(out.reasons).toEqual({});
    });
  });

  describe('the settings the screen sends back to be saved', () => {
    it('are bare values, held to the same offers and not asked for reasons', () => {
      const sent = { permission: 'worktree', tracker: 'read', shell: 'allowlist', tools: { ...WORKSPACE_TOOLS, files: false }, stages: ['plan'], squad: 'payments', turnsTo: 'qa' };
      const out = clampSettings(sent, offers(), base(), { needReason: false });
      expect(out.settings).toEqual({ permission: 'worktree', tracker: 'read', shell: 'allowlist', tools: { ...WORKSPACE_TOOLS, files: false }, stages: ['plan'], squad: 'payments', turnsTo: 'qa' });
    });

    it('still refuse host, a sandbox that is not there and ids that do not exist', () => {
      const out = clampSettings({ shell: 'host', squad: 'ghosts', stages: ['nope'], turnsTo: 'nobody' }, offers(), base(), { needReason: false });
      expect(out.settings).toEqual(MINIMUM_SETTINGS);
      expect(clampSettings({ shell: 'sandbox' }, offers({ sandbox: false }), base(), { needReason: false }).settings.shell).toBe('none');
    });

    it('take the tracker tools from the base even when the screen sends others', () => {
      const had = { ...WORKSPACE_TOOLS, trackerMcp: true, trackerMcpServer: 'tracker' };
      const out = clampSettings({ tools: { ...WORKSPACE_TOOLS, files: false, trackerMcp: false, trackerMcpServer: 'evil' } }, offers(), base({ tools: had }), { needReason: false });
      expect(out.settings.tools).toEqual({ ...had, files: false });
    });

    it('take a null for the tools as the workspace tools', () => {
      const had = { ...WORKSPACE_TOOLS, files: false };
      expect(clampSettings({ tools: null }, offers(), base({ tools: had }), { needReason: false }).settings.tools).toBeNull();
    });

    it('keep the host of the agent when it is sent back unchanged, and refuse it otherwise', () => {
      const had = base({ permission: 'worktree', shell: 'host' });
      expect(clampSettings({ shell: 'host' }, offers(), had, { needReason: false }).settings.shell).toBe('host');
      expect(clampSettings({ shell: 'host' }, offers(), base(), { needReason: false }).settings.shell).toBe('none');
    });
  });
});

describe('isAboveMinimum', () => {
  it('is about each field against the base', () => {
    const had = base({ tracker: 'read', stages: ['plan', 'refine'], tools: { ...WORKSPACE_TOOLS, files: false } });
    expect(isAboveMinimum('tracker', had, MINIMUM_SETTINGS)).toBe(true);
    expect(isAboveMinimum('permission', had, MINIMUM_SETTINGS)).toBe(false);
    expect(isAboveMinimum('stages', had, MINIMUM_SETTINGS)).toBe(true);
    expect(isAboveMinimum('stages', base({ stages: ['refine', 'plan'] }), had)).toBe(false);
    expect(isAboveMinimum('tools', had, MINIMUM_SETTINGS)).toBe(true);
    expect(isAboveMinimum('tools', base({ tools: { ...WORKSPACE_TOOLS, files: false } }), had)).toBe(false);
    expect(isAboveMinimum('tools', base(), had)).toBe(true);
    expect(isAboveMinimum('squad', base({ squad: 'payments' }), MINIMUM_SETTINGS)).toBe(true);
    expect(isAboveMinimum('turnsTo', MINIMUM_SETTINGS, MINIMUM_SETTINGS)).toBe(false);
  });
});

describe('the schemas the model answers', () => {
  // Only these keywords: some servers of the open engine refuse the size keywords in strict mode.
  const ALLOWED = new Set(['type', 'properties', 'required', 'additionalProperties', 'enum', 'items']);

  function keywords(node: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(node)) for (const n of node) keywords(n, found);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties') for (const child of Object.values(value as object)) keywords(child, found);
        else {
          found.add(key);
          if (key === 'items') keywords(value, found);
        }
      }
    }
    return found;
  }

  it('use no keyword beyond type, properties, required, additionalProperties, enum and items', () => {
    for (const schema of [ASSIST_ROUND_SCHEMA, assistReviewSchema(offers())]) expect([...keywords(schema)].filter((k) => !ALLOWED.has(k))).toEqual([]);
  });

  it('close every object and require all of its properties', () => {
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties));
        for (const child of Object.values(node.properties)) walk(child);
      }
      if (node.items) walk(node.items);
    };
    walk(ASSIST_ROUND_SCHEMA);
    walk(assistReviewSchema(offers()));
  });

  it('lets the round hold the three kinds of question and the three texts of the draft', () => {
    const props = (ASSIST_ROUND_SCHEMA as any).properties;
    expect(props.questions.items.properties.kind.enum).toEqual(['open', 'single', 'multi']);
    expect(Object.keys(props.draft.properties)).toEqual(['name', 'job', 'instructions']);
    expect(props.enough.type).toBe('boolean');
  });

  it('offers the review only what exists: shells the machine has, stages, squads and agents of the lists', () => {
    const props = (assistReviewSchema(offers({ sandbox: false })) as any).properties;
    expect(props.shell.properties.value.enum).toEqual(['none', 'allowlist']);
    expect(props.shell.properties.value.enum).not.toContain('host');
    expect(props.permission.properties.value.enum).toEqual(['read', 'worktree']);
    expect(props.stages.properties.ids.items.enum).toEqual(['refine', 'plan', 'implement']);
    expect(props.squad.properties.id.enum).toEqual(['payments', null]);
    expect(props.turnsTo.properties.id.enum).toEqual(['tech-lead', 'qa', null]);
    expect(assistReviewSchema(offers({ sandbox: true })) as any).toHaveProperty('properties.shell.properties.value.enum', ['none', 'sandbox', 'allowlist']);
  });

  it('has no field for autonomy, commands, model or id', () => {
    const names = Object.keys((assistReviewSchema(offers()) as any).properties);
    expect(names).toEqual(['draft', 'permission', 'tracker', 'shell', 'tools', 'stages', 'squad', 'turnsTo']);
  });

  it('asks for no enum where there is nothing to pick from, rather than an empty one', () => {
    const props = (assistReviewSchema(offers({ stages: [], squads: [], turnsTo: [] })) as any).properties;
    expect(props.stages.properties.ids.items).toEqual({ type: 'string' });
    expect(props.squad.properties.id).toEqual({ type: 'null' });
    expect(props.turnsTo.properties.id).toEqual({ type: 'null' });
  });
});

describe('the id helpers', () => {
  it('moved to the shared config and are still exported by the editor', () => {
    expect(editor.slugOf).toBe(slugOf);
    expect(editor.uniqueId).toBe(uniqueId);
    expect(slugOf('Revisão de Código!')).toBe('revisao-de-codigo');
    expect(uniqueId('reviewer', ['reviewer', 'reviewer-2'])).toBe('reviewer-3');
  });
});
