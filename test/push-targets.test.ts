// The vocabulary of where a notification, a push or a persona's button takes the person. The names added for the persona's chat are valid targets, the older ones are kept,
// and what is not a name of the vocabulary is still refused.
import { describe, expect, it } from 'vitest';
import { PUSH_SCREENS, noticeTarget, parseTarget, targetFromSearch, targetQuery } from '../src/shared/push';
import { HOME } from '../src/renderer/src/home';
import { targetToScreen } from '../src/renderer/src/pushTarget';

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

  it('opens the Overview for `overview` and for `today`, its old name, and the home for `chat` (which is the Overview until the chat is a screen)', () => {
    expect(targetToScreen({ to: 'overview' }, true)).toEqual({ name: 'overview' });
    expect(targetToScreen({ to: 'today' }, true)).toEqual({ name: 'overview' });
    expect(targetToScreen({ to: 'today' }, false)).toEqual({ name: 'overview' });
    expect(targetToScreen({ to: 'chat' }, true)).toEqual(HOME);
  });

  it('opens the pre-daily only with the cards loaded, as before, and the home without them', () => {
    expect(targetToScreen({ to: 'call' }, true)).toEqual({ name: 'call' });
    expect(targetToScreen({ to: 'call' }, false)).toEqual(HOME);
  });

  it('remembers that a deep dive came from the home, and lets the plain names open as they did', () => {
    expect(targetToScreen({ to: 'deep', ref: 'group/project#123' }, true)).toEqual({ name: 'deep', ref: 'group/project#123', back: 'chat' });
    expect(targetToScreen({ to: 'deep' }, true)).toBeNull();
    for (const to of ['settings', 'history', 'actions', 'retro']) expect(targetToScreen({ to }, true)).toEqual({ name: to });
  });
});
