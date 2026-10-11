import { t } from '../../shared/i18n';
import { type PushTarget, PUSH_SCREENS, parseTarget } from '../../shared/push';
import type { CeremonyId } from '../../shared/config/types';
import { MAX_BUTTONS } from '../forum-core';
import type { Json } from '../engine/open/types';
import { type ToolImpl, ToolError } from '../engine/open/tools/types';
import { mrOutOfReach } from '../vcs/readTool';

// `OpenScreen`: the one tool of the persona that is its own. It never navigates: it checks a target of the notification vocabulary against what the workspace has and adds a
// button to the answer being written. The person taps the button, on the device they hold, and that device alone moves. The app words the button from the target; the model
// writes no label, so a button cannot say one thing and open another.

export const OPEN_SCREEN_TOOL = 'OpenScreen';

/** The screens a button may open: the whole vocabulary but the home itself and the alias of the Overview. */
export const BUTTON_SCREENS = PUSH_SCREENS.filter((s) => s !== 'chat' && s !== 'today');

/** The ceremony each target needs the cycle to have. */
const NEEDS_CEREMONY: Record<string, CeremonyId> = { call: 'preDaily', deep: 'unblock', gate: 'gate', qa: 'qaHandoff', retro: 'retro' };

/** What the workspace has, as the tool asks for it; the real facts come from the cycle, the cards, the runs, Actions and the forum (runtime.ts). */
export interface ScreenFacts {
  /** Which ceremonies the cycle offers right now. */
  ceremonies(): Record<CeremonyId, boolean>;
  /** What the workspace calls a ceremony (the pre-daily has the name the cycle gives it), for the line that refuses it. */
  ceremonyName(id: CeremonyId): string;
  /** The references of the cards loaded now (not refreshed from the host). */
  cards(): Promise<readonly string[]>;
  run(id: string): boolean;
  conflict(id: string): boolean;
  thread(id: string): boolean;
  /** The projects the workspace may read ("group/repo"); none means a merge request named by project and number is refused. */
  projects?(): readonly string[];
}

/** The buttons one answer carries: at most four, each target once. */
export interface Buttons {
  add(target: PushTarget): 'added' | 'duplicate' | 'full';
  list(): PushTarget[];
}

export function createButtons(): Buttons {
  const buttons: PushTarget[] = [];
  const key = (b: PushTarget): string => JSON.stringify([b.to, b.ref ?? '', b.id ?? '', b.mr ?? '', (b.project ?? '').toLowerCase(), b.number ?? 0]);
  return {
    add(target) {
      if (buttons.some((b) => key(b) === key(target))) return 'duplicate';
      if (buttons.length >= MAX_BUTTONS) return 'full';
      buttons.push(target);
      return 'added';
    },
    list: () => [...buttons],
  };
}

/** The refusal of a target that is not valid, as the model reads it. */
const invalid = (to: string): string => t('main.persona.openScreen.invalid', { to: to || '—', list: BUTTON_SCREENS.join(', ') });

/** Checks a target against the workspace. The reason it cannot be a button, in the words the model reads, or null when it can. */
export async function whyNot(target: PushTarget, facts: ScreenFacts): Promise<string | null> {
  const need = NEEDS_CEREMONY[target.to];
  if (need && !facts.ceremonies()[need]) return t('main.persona.openScreen.off', { ceremony: facts.ceremonyName(need) });
  if (target.ref) {
    const cards = await facts.cards();
    if (!cards.includes(target.ref)) return t('main.persona.openScreen.noCard', { ref: target.ref, list: cards.slice(0, 5).join(', ') || '—' });
  }
  if (target.to === 'run' && target.id && !facts.run(target.id)) return t('main.persona.openScreen.noRun', { id: target.id });
  if (target.to === 'conflict' && target.id && !facts.conflict(target.id)) return t('main.persona.openScreen.noConflict', { id: target.id });
  if (target.to === 'forum' && target.id && !facts.thread(target.id)) return t('main.persona.openScreen.noThread', { id: target.id });
  // A merge request named by project and number need not be a card: it must be one of the workspace's projects, as the screen will check again when it reads.
  if (target.project !== undefined) return mrOutOfReach(target.project, target.number, facts.projects?.() ?? []);
  return null;
}

/** The target fields a tool's input carries, trimmed; a number only when the model gave one. */
function targetOf(to: string, input: Record<string, unknown>): PushTarget | null {
  const text = (key: 'ref' | 'id' | 'mr' | 'project') => (typeof input[key] === 'string' && input[key] ? { [key]: (input[key] as string).trim() } : {});
  return parseTarget({ to, ...text('ref'), ...text('id'), ...text('mr'), ...text('project'), ...(input.number !== undefined ? { number: input.number } : {}) });
}

function addButton(buttons: Buttons, target: PushTarget): { response: string; render: typeof String } {
  const added = buttons.add(target);
  const response = added === 'added' ? t('main.persona.openScreen.added') : added === 'duplicate' ? t('main.persona.openScreen.duplicate') : t('main.persona.openScreen.full', { max: MAX_BUTTONS });
  return { response, render: String };
}

export const OPEN_DISCUSSIONS_TOOL = 'OpenDiscussions';

/**
 * The one action of an agent that answers in a conversation and is not the persona: a button, under its answer, that opens the discussions of a merge request. Like the
 * persona's, it opens nothing itself; the person taps it on the device they hold. `projects` is what the workspace may read, checked strictly.
 */
export function openDiscussionsTool(projects: () => readonly string[], buttons: Buttons): ToolImpl {
  return {
    name: OPEN_DISCUSSIONS_TOOL,
    // i18n-ignore: prompt and tool texts the engines send the model: English by design
    description:
      'Offers the person a button that opens the screen with the open review discussions of a merge request, also one that is not a card of the day. It opens nothing itself: the button is added under your answer and the person taps it. If it refuses, say why in your answer.',
    parameters: {
      type: 'object',
      properties: {
        // i18n-ignore-start: prompt and tool texts the engines send the model: English by design
        project: { type: 'string', description: 'group/repo of the merge request, as in mrPaths.' },
        number: { type: 'integer', description: 'The number the code host shows for the merge request.' },
        // i18n-ignore-end
      },
      required: ['project', 'number'],
      additionalProperties: false,
    } as unknown as Json,
    note: true,
    async run(input) {
      const project = typeof input.project === 'string' ? input.project.trim() : '';
      const why = mrOutOfReach(project, input.number, projects());
      if (why) throw new ToolError(why);
      const target = targetOf('discussions', { project, number: input.number });
      if (!target) throw new ToolError(invalid('discussions'));
      return addButton(buttons, target);
    },
  };
}

export function openScreenTool(facts: ScreenFacts, buttons: Buttons): ToolImpl {
  return {
    name: OPEN_SCREEN_TOOL,
    // i18n-ignore: prompt and tool texts the engines send the model: English by design
    description:
      'Offers the person a button that opens a screen of the app or starts a ceremony (the pre-daily, the QA hand-off, the retro, the board, an activity, a run...). It opens nothing itself: the button is added under your answer and the person taps it. Use it when they ask to start or open something, instead of telling them where to click. If it refuses, say why in your answer. At most four buttons per answer.',
    parameters: {
      type: 'object',
      properties: {
        // i18n-ignore-start: prompt and tool texts the engines send the model: English by design
        to: { type: 'string', enum: BUTTON_SCREENS, description: 'The screen: call is the pre-daily; deep, gate, qa, quick and reentry need the ref of a card of the day; discussions needs the ref of a card of the day, or project and number of any merge request; run and conflict need an id; forum may take a thread id.' },
        ref: { type: 'string', description: 'The reference of the card, as the cards of the day show it.' },
        id: { type: 'string', description: 'The id of a run, a conflict or a conversation.' },
        mr: { type: 'string', description: 'The reference of a merge request of the card, for discussions.' },
        project: { type: 'string', description: 'group/repo of a merge request that is not a card of the day, for discussions (with number).' },
        number: { type: 'integer', description: 'The number the code host shows for that merge request, for discussions (with project).' },
        // i18n-ignore-end
      },
      required: ['to'],
      additionalProperties: false,
    } as unknown as Json,
    // The principal's alone: a sub-agent reads, and offers nothing to the person.
    principalOnly: true,
    // Posting a button moves no work forward: a model that only offers buttons for a few steps is taken as done.
    note: true,
    async run(input) {
      const to = typeof input.to === 'string' ? input.to.trim() : '';
      // A merge request out of reach is refused with its reason, not as an invalid target.
      if (to === 'discussions' && input.project !== undefined) {
        const why = mrOutOfReach(typeof input.project === 'string' ? input.project.trim() : '', input.number, facts.projects?.() ?? []);
        if (why) throw new ToolError(why);
      }
      const target = targetOf(to, input);
      if (!target || !BUTTON_SCREENS.includes(target.to)) throw new ToolError(invalid(to));
      const why = await whyNot(target, facts);
      if (why) throw new ToolError(why);
      return addButton(buttons, target);
    },
  };
}
