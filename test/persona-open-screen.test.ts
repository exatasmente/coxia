// OpenScreen, the persona's one tool of its own: it never navigates, it checks a target against what the workspace has and adds a button to the answer. A target that does not
// parse, a ceremony the cycle has turned off, a card that is not loaded, a run that is not there are refused with the reason, and no button is made.
import { describe, expect, it } from 'vitest';
import { ToolError } from '../src/main/engine/open/tools/types';
import { BUTTON_SCREENS, OPEN_SCREEN_TOOL, type ScreenFacts, createButtons, openScreenTool, whyNot } from '../src/main/persona/openScreen';
import { t } from '../src/shared/i18n';
import { PUSH_SCREENS, parseTarget } from '../src/shared/push';

const ALL_ON = { preDaily: true, unblock: true, gate: true, qaHandoff: true, retro: true, releaseConflicts: true };
const facts = (over: Partial<ScreenFacts> = {}): ScreenFacts => ({
  ceremonies: () => ALL_ON,
  ceremonyName: (id) => (id === 'preDaily' ? 'morning sync' : t(`main.persona.openScreen.ceremony.${id}`)),
  cards: async () => ['app#1', 'app#2'],
  run: (id) => id === 'r1',
  conflict: (id) => id === 'c1',
  thread: (id) => id === 'agent-turn',
  ...over,
});
const ctx = {} as never;

function setup(over: Partial<ScreenFacts> = {}) {
  const buttons = createButtons();
  const tool = openScreenTool(facts(over), buttons);
  const run = (input: Record<string, unknown>) => tool.run(input as never, ctx);
  const refused = async (input: Record<string, unknown>): Promise<string> => {
    try {
      await run(input);
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return (e as Error).message;
    }
    throw new Error('the tool did not refuse');
  };
  return { buttons, tool, run, refused };
}

describe('OpenScreen', () => {
  it('is the principal\'s alone, and its parameters name the screens a button may open: not the home, not the alias', () => {
    const { tool } = setup();
    expect(tool.name).toBe(OPEN_SCREEN_TOOL);
    expect(tool.principalOnly).toBe(true);
    expect(BUTTON_SCREENS).not.toContain('chat');
    expect(BUTTON_SCREENS).not.toContain('today');
    expect(BUTTON_SCREENS).toEqual(expect.arrayContaining(['call', 'overview', 'board', 'procedures', 'memory', 'deep', 'qa', 'run', 'forum']));
    expect(BUTTON_SCREENS.every((s) => PUSH_SCREENS.includes(s))).toBe(true);
  });

  it('adds a button for a ceremony the cycle has and for a plain screen, and says that nothing was opened', async () => {
    const { buttons, run } = setup();
    const done = await run({ to: 'call' });
    expect(String(done.response)).toBe(t('main.persona.openScreen.added'));
    await run({ to: 'board' });
    expect(buttons.list()).toEqual([{ to: 'call' }, { to: 'board' }]);
  });

  it('every button it makes passes parseTarget', async () => {
    const { buttons, run } = setup();
    await run({ to: 'deep', ref: 'app#1' });
    await run({ to: 'run', id: 'r1' });
    await run({ to: 'conflict', id: 'c1' });
    await run({ to: 'forum', id: 'agent-turn' });
    expect(buttons.list()).toHaveLength(4);
    for (const b of buttons.list()) expect(parseTarget(b)).toEqual(b);
  });

  it('refuses a target that does not parse: an unknown screen, one that needs a ref or an id, a field with a bad character', async () => {
    const { buttons, refused } = setup();
    const invalid = (to: string) => t('main.persona.openScreen.invalid', { to, list: BUTTON_SCREENS.join(', ') });
    expect(await refused({ to: 'nowhere' })).toBe(invalid('nowhere'));
    expect(await refused({ to: 'deep' })).toBe(invalid('deep'));
    expect(await refused({ to: 'run' })).toBe(invalid('run'));
    expect(await refused({ to: 'conflict' })).toBe(invalid('conflict'));
    expect(await refused({ to: 'qa', ref: 'has space' })).toBe(invalid('qa'));
    expect(await refused({})).toBe(invalid('—'));
    // the home and the alias are not buttons
    expect(await refused({ to: 'chat' })).toBe(invalid('chat'));
    expect(await refused({ to: 'today' })).toBe(invalid('today'));
    expect(buttons.list()).toEqual([]);
  });

  it('refuses a ceremony the cycle has turned off, naming it, and makes no button', async () => {
    const { buttons, refused } = setup({ ceremonies: () => ({ ...ALL_ON, preDaily: false, retro: false, qaHandoff: false, unblock: false, gate: false }) });
    expect(await refused({ to: 'call' })).toBe(t('main.persona.openScreen.off', { ceremony: 'morning sync' }));
    expect(await refused({ to: 'retro' })).toBe(t('main.persona.openScreen.off', { ceremony: t('main.persona.openScreen.ceremony.retro') }));
    expect(await refused({ to: 'qa', ref: 'app#1' })).toBe(t('main.persona.openScreen.off', { ceremony: t('main.persona.openScreen.ceremony.qaHandoff') }));
    expect(await refused({ to: 'deep', ref: 'app#1' })).toBe(t('main.persona.openScreen.off', { ceremony: t('main.persona.openScreen.ceremony.unblock') }));
    expect(await refused({ to: 'gate', ref: 'app#1' })).toBe(t('main.persona.openScreen.off', { ceremony: t('main.persona.openScreen.ceremony.gate') }));
    expect(buttons.list()).toEqual([]);
  });

  it('refuses a card that is not among the loaded ones, listing some that are, for every screen that takes a ref', async () => {
    const { buttons, refused } = setup();
    for (const to of ['deep', 'gate', 'qa', 'quick', 'reentry', 'discussions']) {
      expect(await refused({ to, ref: 'app#9' }), to).toBe(t('main.persona.openScreen.noCard', { ref: 'app#9', list: 'app#1, app#2' }));
    }
    expect(buttons.list()).toEqual([]);
  });

  it('refuses a run, a conflict and a conversation that are not there', async () => {
    const { buttons, refused } = setup();
    expect(await refused({ to: 'run', id: 'r9' })).toBe(t('main.persona.openScreen.noRun', { id: 'r9' }));
    expect(await refused({ to: 'conflict', id: 'c9' })).toBe(t('main.persona.openScreen.noConflict', { id: 'c9' }));
    expect(await refused({ to: 'forum', id: 'g-gone' })).toBe(t('main.persona.openScreen.noThread', { id: 'g-gone' }));
    expect(buttons.list()).toEqual([]);
  });

  it('keeps at most four buttons per answer and each target once', async () => {
    const { buttons, run } = setup();
    expect(String((await run({ to: 'call' })).response)).toBe(t('main.persona.openScreen.added'));
    expect(String((await run({ to: 'call' })).response)).toBe(t('main.persona.openScreen.duplicate'));
    await run({ to: 'board' });
    await run({ to: 'memory' });
    await run({ to: 'procedures' });
    expect(String((await run({ to: 'history' })).response)).toBe(t('main.persona.openScreen.full', { max: 4 }));
    expect(buttons.list()).toEqual([{ to: 'call' }, { to: 'board' }, { to: 'memory' }, { to: 'procedures' }]);
    // the same screen for a different card is another button
    const other = setup();
    await other.run({ to: 'deep', ref: 'app#1' });
    await other.run({ to: 'deep', ref: 'app#2' });
    expect(other.buttons.list()).toHaveLength(2);
  });

  it('checks a target without the tool: whyNot is null for what the workspace has', async () => {
    expect(await whyNot({ to: 'call' }, facts())).toBeNull();
    expect(await whyNot({ to: 'run', id: 'r1' }, facts())).toBeNull();
    expect(await whyNot({ to: 'run', id: 'nope' }, facts())).not.toBeNull();
  });
});
