// The decisions of the persona's Stop above the markup (#248): the one control, the banner, the indicator of the shell, the wording of a message that waits, and that the screens
// that draw them use tokens and catalog keys only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_STOPPED, readPersonaState, type PersonaState } from '../src/shared/personaStop';
import { bannerView, controlOf, indicatorView, queuedKey } from '../src/renderer/src/personaStopModel';
import en from '../src/shared/i18n/ui-persona.en.json';
import ptBR from '../src/shared/i18n/ui-persona.pt-BR.json';

const stopped = (over: Partial<PersonaState> = {}): PersonaState => ({ stopped: true, since: '2026-10-11T10:00:00Z', door: 'window', waiting: 0, ...over });

describe('the control', () => {
  it('is Stop while the persona may act and Resume while it is stopped, the same button', () => {
    expect(controlOf(NOT_STOPPED)).toEqual({ action: 'stop', label: 'ui.persona.stop.button', short: 'ui.persona.stop.short', title: 'ui.persona.stop.title' });
    expect(controlOf(stopped())).toEqual({ action: 'resume', label: 'ui.persona.resume.button', short: 'ui.persona.resume.short', title: 'ui.persona.resume.title' });
  });
});

describe('the words of the control', () => {
  const words = en as Record<string, string>;
  const palavras = ptBR as Record<string, string>;

  it('name the persona, so the header\'s control is not read as the Stop of one answer', () => {
    expect(words['ui.persona.stop.button']).toBe('Stop the persona');
    expect(words['ui.persona.resume.button']).toBe('Resume the persona');
    expect(palavras['ui.persona.stop.button']).toBe('Parar a persona');
    expect(palavras['ui.persona.resume.button']).toBe('Retomar a persona');
  });

  it('have a short form that the long one contains, so a header with no room draws it and keeps the long name', () => {
    for (const [short, long] of [['ui.persona.stop.short', 'ui.persona.stop.button'], ['ui.persona.resume.short', 'ui.persona.resume.button']]) {
      expect(words[long].startsWith(words[short])).toBe(true);
      expect(palavras[long].startsWith(palavras[short])).toBe(true);
    }
    const control = readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/persona/StopControl.tsx'), 'utf8');
    expect(control).toMatch(/aria-label=\{compact \? t\(control\.label\) : undefined\}/);
    expect(readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/persona/ChatHeader.tsx'), 'utf8')).toContain('<StopControl compact={phone} />');
  });
});

describe('the banner over the box', () => {
  it('shows only while stopped, with the count of messages that wait', () => {
    expect(bannerView(NOT_STOPPED)).toEqual({ shown: false, waiting: 0 });
    expect(bannerView(stopped())).toEqual({ shown: true, waiting: 0 });
    expect(bannerView(stopped({ waiting: 3 }))).toEqual({ shown: true, waiting: 3 });
  });
});

describe('the indicator of the shell', () => {
  it('is hidden when the persona is idle and may act', () => {
    expect(indicatorView({ state: NOT_STOPPED, working: false, screen: 'settings' })).toBe('hidden');
  });

  it('shows working while an answer is being written, and stopped while stopped, whichever is true first', () => {
    expect(indicatorView({ state: NOT_STOPPED, working: true, screen: 'overview' })).toBe('working');
    expect(indicatorView({ state: stopped(), working: false, screen: 'overview' })).toBe('stopped');
    expect(indicatorView({ state: stopped(), working: true, screen: 'actions' })).toBe('stopped');
  });

  it('is never drawn on the chat, whose header has the control', () => {
    expect(indicatorView({ state: stopped(), working: true, screen: 'chat' })).toBe('hidden');
    expect(indicatorView({ state: NOT_STOPPED, working: true, screen: 'chat' })).toBe('hidden');
  });
});

describe('a message that waits', () => {
  it('says it waits for Resume while the persona is stopped, and for its turn otherwise', () => {
    expect(queuedKey(true)).toBe('ui.chat.queuedStopped');
    expect(queuedKey(false)).toBe('ui.chat.queued');
  });
});

describe('the state on the wire', () => {
  it('reads what the main process sends and refuses what is not a state', () => {
    expect(readPersonaState({ stopped: true, since: 'x', door: 'paired', waiting: 2 })).toEqual({ stopped: true, since: 'x', door: 'paired', waiting: 2 });
    expect(readPersonaState({ stopped: false })).toEqual(NOT_STOPPED);
    expect(readPersonaState({ stopped: true, waiting: -4 })?.waiting).toBe(0);
    for (const bad of [null, undefined, 3, 'yes', [], { stopped: 'yes' }, {}]) expect(readPersonaState(bad), String(bad)).toBeNull();
  });
});

describe('where the indicator sits', () => {
  const css = readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/persona/chat.css'), 'utf8');
  const rule = (selector: string): string => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));

  it('is a bar in the flow on the computer, so it lies over no content, and a pill at the foot of the screen only on a phone', () => {
    expect(rule('.persona-indicator')).not.toMatch(/position:\s*fixed/);
    const phone = css.slice(css.indexOf('@media (max-width: 600px) { .persona-indicator'));
    expect(phone).toMatch(/position: fixed/);
    expect(phone).toMatch(/bottom: calc\(16px/);
  });

  it('is drawn above the screen it belongs to, not after it, in the shell', () => {
    const app = readFileSync(join(import.meta.dirname, '../src/renderer/src/App.tsx'), 'utf8');
    expect(app.indexOf('<PersonaIndicator')).toBeGreaterThan(-1);
    expect(app.indexOf('<PersonaIndicator')).toBeLessThan(app.indexOf('{view}'));
  });
});

describe('the words and the colours', () => {
  const keys = ['ui.persona.stop.button', 'ui.persona.stop.short', 'ui.persona.stop.title', 'ui.persona.resume.button', 'ui.persona.resume.short', 'ui.persona.resume.title', 'ui.persona.banner', 'ui.persona.banner.waiting_one', 'ui.persona.banner.waiting_other', 'ui.persona.indicator.working', 'ui.persona.indicator.stopped', 'ui.persona.section.state.running', 'ui.persona.section.state.stopped', 'ui.chat.queuedStopped'];

  it('are in both catalogs, worded differently', () => {
    for (const key of keys) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((ptBR as Record<string, string>)[key], key).toBeTruthy();
      expect((en as Record<string, string>)[key], key).not.toBe((ptBR as Record<string, string>)[key]);
    }
  });

  it('are drawn with theme tokens only', () => {
    const root = join(import.meta.dirname, '../src/renderer/src/screens/persona');
    const css = readFileSync(join(root, 'chat.css'), 'utf8');
    const mine = css.slice(css.indexOf('the Stop of the persona'));
    expect(mine.length).toBeGreaterThan(100);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    for (const file of ['StopControl.tsx', 'PersonaIndicator.tsx']) expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });

  it('puts the control in the chat header, the banner in the chat screen, the indicator in the shell and the state in Settings', () => {
    const src = join(import.meta.dirname, '../src/renderer/src');
    expect(readFileSync(join(src, 'screens/persona/ChatHeader.tsx'), 'utf8')).toContain('<StopControl compact={phone} />');
    expect(readFileSync(join(src, 'screens/persona/ChatScreen.tsx'), 'utf8')).toContain('<StoppedBanner />');
    expect(readFileSync(join(src, 'App.tsx'), 'utf8')).toContain('<PersonaIndicator screen={screen.name} />');
    expect(readFileSync(join(src, 'screens/persona/PersonaSection.tsx'), 'utf8')).toContain('<StopControl />');
  });
});

describe('what a stopped persona shows as going', () => {
  const tops = [
    { kind: 'conversation', id: 'agent-me', key: 'a' },
    { kind: 'conversation', id: 'general', key: 'b' },
    { kind: 'run', id: 'r-1', key: 'c' },
    { kind: 'agent', id: 'agent-me', key: 'd' },
  ];
  const isPersonaThread = (thread: string): boolean => thread === 'agent-me';

  it('keeps the persona\'s own conversation out of the dock while it is stopped, and everything else in', async () => {
    const { withoutHeldPersona } = await import('../src/renderer/src/personaStopModel');
    expect(withoutHeldPersona(tops, { stopped: true, isPersonaThread }).map((e) => e.key)).toEqual(['b', 'c', 'd']);
    expect(withoutHeldPersona(tops, { stopped: false, isPersonaThread }).map((e) => e.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not say an answer is going while the persona is stopped, and says it as before otherwise', async () => {
    const { answerGoing } = await import('../src/renderer/src/personaStopModel');
    expect(answerGoing({ going: true, stopped: true })).toBe(false);
    expect(answerGoing({ going: true, stopped: false })).toBe(true);
    expect(answerGoing({ going: false, stopped: false })).toBe(false);
  });
});
