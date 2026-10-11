// The vocabulary of where a notification, a push or a persona's button takes the person. The names added for the persona's chat are valid targets, the older ones are kept,
// and what is not a name of the vocabulary is still refused.
import { describe, expect, it, vi } from 'vitest';
import { PUSH_SCREENS, noticeTarget, parseTarget, targetFromSearch, targetQuery } from '../src/shared/push';
import { HOME } from '../src/renderer/src/home';
import { buttonScreen, targetToScreen } from '../src/renderer/src/pushTarget';
import { openButton } from '../src/renderer/src/openButton';

const opened = vi.hoisted(() => [] as unknown[][]);
vi.mock('../src/renderer/src/feedbackApi', () => ({
  feedbackApi: {
    discussionsOpened: async (...args: unknown[]) => {
      opened.push(args);
      return true;
    },
  },
}));

describe('parseTarget', () => {
  it.each(['chat', 'overview', 'today', 'call', 'board', 'procedures', 'memory'])('accepts %s', (to) => {
    expect(parseTarget({ to })).toEqual({ to });
  });

  it('still accepts every name it accepted before', () => {
    for (const to of ['today', 'call', 'ata', 'history', 'settings', 'actions', 'retro', 'custo', 'radar', 'saude', 'auditoria', 'help', 'glossario', 'runs', 'forum']) expect(parseTarget({ to })?.to).toBe(to);
    expect(PUSH_SCREENS).toEqual(expect.arrayContaining(['chat', 'overview', 'board', 'procedures', 'memory', 'today', 'call']));
  });

  it('still refuses a name that is not in the vocabulary, a screen that needs a ref or an id without it, and a field with a bad character', () => {
    expect(parseTarget({ to: 'nowhere' })).toBeNull();
    expect(parseTarget({ to: 'deep' })).toBeNull();
    expect(parseTarget({ to: 'run' })).toBeNull();
    expect(parseTarget({ to: 'conflict' })).toBeNull();
    expect(parseTarget({ to: 'qa', ref: 'has space' })).toBeNull();
    expect(parseTarget({ to: 7 })).toBeNull();
    expect(parseTarget(null)).toBeNull();
  });

  it('carries a ref, an id and an mr, and nothing else', () => {
    expect(parseTarget({ to: 'discussions', ref: 'app#1', mr: '2', extra: 'x' })).toEqual({ to: 'discussions', ref: 'app#1', mr: '2' });
  });
});

describe('the URL and the notice of a target', () => {
  it('round-trips the new names through the query a push opens', () => {
    for (const to of ['chat', 'overview', 'board']) expect(targetFromSearch(`?${targetQuery({ to })}`)).toEqual({ to });
  });

  it('opens something for a notice made before the update: today and call are still valid', () => {
    expect(targetFromSearch('?open=today')).toEqual({ to: 'today' });
    expect(targetFromSearch('?open=call')).toEqual({ to: 'call' });
    expect(noticeTarget({ type: 'navigate', to: 'today' })).toEqual({ to: 'today' });
    expect(noticeTarget({ type: 'navigate', to: 'call' })).toEqual({ to: 'call' });
  });
});

describe('the screen a target opens on a device', () => {
  it('opens a plain screen for the screens a persona\'s button names', () => {
    expect(targetToScreen({ to: 'board' }, true)).toEqual({ name: 'board' });
    expect(targetToScreen({ to: 'procedures' }, true)).toEqual({ name: 'procedures' });
    expect(targetToScreen({ to: 'memory' }, true)).toEqual({ name: 'memory' });
  });

  it('opens the Overview for `overview` and for `today`, its old name, and the chat for `chat`', () => {
    expect(targetToScreen({ to: 'overview' }, true)).toEqual({ name: 'overview' });
    expect(targetToScreen({ to: 'today' }, true)).toEqual({ name: 'overview' });
    expect(targetToScreen({ to: 'today' }, false)).toEqual({ name: 'overview' });
    expect(targetToScreen({ to: 'chat' }, true)).toEqual({ name: 'chat' });
    expect(targetToScreen({ to: 'chat' }, false)).toEqual({ name: 'chat' });
  });

  it('opens the pre-daily only with the cards loaded, as before, and the home without them', () => {
    expect(targetToScreen({ to: 'call' }, true)).toEqual({ name: 'call' });
    expect(targetToScreen({ to: 'call' }, false)).toEqual(HOME);
  });

  it('opens the Overview, not the wizard, when the workspace has no persona and a notice points at the home', () => {
    expect(targetToScreen({ to: 'chat' }, true, true)).toEqual({ name: 'overview' });
    expect(targetToScreen({ to: 'call' }, false, true)).toEqual({ name: 'overview' });
    // The pre-daily screen itself, and every other target, are not the home and stay as they are.
    expect(targetToScreen({ to: 'call' }, true, true)).toEqual({ name: 'call' });
    expect(targetToScreen({ to: 'settings' }, true, true)).toEqual({ name: 'settings' });
    expect(targetToScreen({ to: 'chat' }, true, false)).toEqual({ name: 'chat' });
  });

  it('remembers that a deep dive came from the home, and lets the plain names open as they did', () => {
    expect(targetToScreen({ to: 'deep', ref: 'group/project#123' }, true)).toEqual({ name: 'deep', ref: 'group/project#123', back: 'chat' });
    expect(targetToScreen({ to: 'deep' }, true)).toBeNull();
    for (const to of ['settings', 'history', 'actions', 'retro']) expect(targetToScreen({ to }, true)).toEqual({ name: to });
  });

  it('opens the discussions of a merge request by project and number, without a card, and of a card by its ref as before', () => {
    expect(targetToScreen({ to: 'discussions', project: 'group/app', number: 7 }, false)).toEqual({ name: 'discussions', project: 'group/app', number: 7 });
    expect(targetToScreen({ to: 'discussions', ref: 'app#1', mr: 'x' }, true)).toEqual({ name: 'discussions', ref: 'app#1', mr: 'x' });
    expect(targetToScreen({ to: 'discussions' }, true)).toBeNull();
  });
});

describe('a merge request named by project and number', () => {
  it('is a discussions target without a ref, and round-trips through the query a push opens', () => {
    const target = { to: 'discussions', project: 'group/app', number: 7 };
    expect(parseTarget(target)).toEqual(target);
    expect(targetFromSearch(`?${targetQuery(target)}`)).toEqual(target);
    expect(noticeTarget({ type: 'open', screen: { name: 'discussions', project: 'group/app', number: 7 } } as never)).toEqual(target);
  });

  it('refuses half of it, a bad project or number, and the pair on another screen', () => {
    expect(parseTarget({ to: 'discussions', project: 'group/app' })).toBeNull();
    expect(parseTarget({ to: 'discussions', number: 7 })).toBeNull();
    expect(parseTarget({ to: 'discussions', project: 'app', number: 7 })).toBeNull();
    expect(parseTarget({ to: 'discussions', project: 'group/app', number: 0 })).toBeNull();
    expect(parseTarget({ to: 'discussions', project: 'group/app', number: 1.5 })).toBeNull();
    expect(parseTarget({ to: 'deep', ref: 'app#1', project: 'group/app', number: 7 })).toBeNull();
    expect(targetFromSearch('?open=discussions&project=group/app&number=7abc')).toBeNull();
  });

  it('refuses a project whose part is only dots, and keeps a name that only has dots in it', () => {
    for (const project of ['../..', '../app', 'group/..', './app', 'group/.']) expect(parseTarget({ to: 'discussions', project, number: 7 })).toBeNull();
    expect(parseTarget({ to: 'discussions', project: 'group/app.v2', number: 7 })?.project).toBe('group/app.v2');
    expect(parseTarget({ to: 'discussions', project: '.github/site', number: 7 })?.project).toBe('.github/site');
  });
});

describe('a button tapped under an answer in a conversation', () => {
  const back = { name: 'run', id: 'r1', tab: 'forum' } as const;

  it('opens the discussions of a merge request with Back to that conversation', () => {
    expect(buttonScreen({ to: 'discussions', project: 'group/app', number: 7 }, false, back)).toEqual({ name: 'discussions', project: 'group/app', number: 7, back });
  });

  it('leaves every other screen as a notice would open it', () => {
    expect(buttonScreen({ to: 'discussions', ref: 'app#1', mr: 'x' }, true, back)).toEqual({ name: 'discussions', ref: 'app#1', mr: 'x' });
    expect(buttonScreen({ to: 'board' }, true, back)).toEqual({ name: 'board' });
    expect(buttonScreen({ to: 'discussions' }, true, back)).toBeNull();
  });

  it('asks main for the line of the conversation only for a merge request named by project and number, and opens the screen either way', async () => {
    opened.length = 0;
    const went: unknown[] = [];
    openButton({ to: 'discussions', project: 'group/app', number: 7 }, { thread: 'run-r1', hasCards: false, back, go: (s) => went.push(s) });
    openButton({ to: 'board' }, { thread: 'run-r1', hasCards: false, back, go: (s) => went.push(s) });
    expect(opened).toEqual([['run-r1', 'group/app', 7]]);
    expect(went).toEqual([{ name: 'discussions', project: 'group/app', number: 7, back }, { name: 'board' }]);
  });
});
