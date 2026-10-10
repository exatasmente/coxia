// The prompt editor (Ctrl+Shift+I, the desktop window only): the ids come from the catalogs, never from a list kept by hand; a change of one text in one language
// lands in devCycle.promptOverrides, is what the next prompt says, and goes back to the catalog's text with a null; a paired browser can neither list nor write.
import { describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { CATALOGS } from '../src/shared/i18n';
import { promptEntries, promptIdOf, promptIds, promptTemplate, renderPrompt, withPromptOverride, type PromptEntry } from '../src/shared/cycles/prompts';
import { webAccess, webRefusal } from '../src/main/webPolicy';
import { getConfig, saveConfig } from '../src/main/workspaceConfig';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {} }));
const { configModule } = await import('../src/main/configModule');

function handlers(): Map<string, (...args: unknown[]) => unknown> {
  const map = new Map<string, (...args: unknown[]) => unknown>();
  configModule({ handle: (channel: string, fn: (...args: never[]) => unknown) => map.set(channel, fn as (...args: unknown[]) => unknown), emit: () => {} } as never);
  return map;
}

describe('the prompt ids', () => {
  it('drops the family and the suffixes of a variant, and keeps an id that only looks like one', () => {
    expect(promptIdOf('prompt.sdd.rules.speech')).toBe('rules.speech');
    expect(promptIdOf('prompt.sdd.rules.speech.novoice')).toBe('rules.speech');
    expect(promptIdOf('prompt.sdd.effects.classify.on-github')).toBe('effects.classify');
    expect(promptIdOf('prompt.scrum.retro.main.off-sdd')).toBe('retro.main');
    expect(promptIdOf('prompt.sdd.x.novoice.on-github')).toBe('x');
    expect(promptIdOf('prompt.sdd.vcs.changes.github')).toBe('vcs.changes.github');
    expect(promptIdOf('ui.prompts.title')).toBeNull();
  });

  it('lists every prompt of the catalogs once, and each one has a text the app can send', () => {
    const ids = promptIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const catalog of Object.values(CATALOGS)) {
      for (const key of Object.keys(catalog)) {
        const id = promptIdOf(key);
        if (id) expect(ids, key).toContain(id);
      }
    }
    const cycle = neutralConfig().devCycle;
    for (const id of ids) expect(promptTemplate(cycle, id, 'pt-BR') ?? promptTemplate(cycle, id, 'en'), id).toBeDefined();
    expect(ids).toContain('turn.main');
    expect(ids.some((id) => id.endsWith('.novoice'))).toBe(false);
  });
});

describe('the entries and the change of one text', () => {
  it('shows the catalog text as the default and the override apart, never mixed', () => {
    const cycle = { ...neutralConfig().devCycle, promptOverrides: { 'turn.main': { en: 'Mine.' } } };
    const entry = promptEntries(cycle).find((p) => p.id === 'turn.main') as PromptEntry;
    expect(entry.defaults['pt-BR']).toBe(promptTemplate({ ...cycle, promptOverrides: {} }, 'turn.main', 'pt-BR'));
    expect(entry.defaults.en).not.toBe('Mine.');
    expect(entry.override).toEqual({ en: 'Mine.' });
  });

  it('sets a text per language, keeps an empty one, drops a language with null and an id with no language left', () => {
    let next = withPromptOverride({}, 'turn.main', 'pt-BR', 'Um.');
    next = withPromptOverride(next, 'turn.main', 'en', '');
    expect(next).toEqual({ 'turn.main': { 'pt-BR': 'Um.', en: '' } });
    next = withPromptOverride(next, 'turn.main', 'pt-BR', null);
    expect(next).toEqual({ 'turn.main': { en: '' } });
    expect(withPromptOverride(next, 'turn.main', 'en', null)).toEqual({});
  });

  it('refuses an id the catalogs do not have: an override of it would never be read', () => {
    expect(() => withPromptOverride({}, 'turn.nope', 'pt-BR', 'x')).toThrow(/unknown prompt/);
  });
});

describe('the channels', () => {
  it('saves a text the next prompt uses, and restores the catalog text with null', () => {
    saveConfig(neutralConfig());
    const h = handlers();
    const before = renderPrompt(getConfig().devCycle, 'rules.chat', 'pt-BR');
    const list = h.get('config:prompt-set')!('rules.chat', 'pt-BR', 'Fale curto.') as PromptEntry[];
    expect(list.find((p) => p.id === 'rules.chat')?.override).toEqual({ 'pt-BR': 'Fale curto.' });
    expect(getConfig().devCycle.promptOverrides['rules.chat']).toEqual({ 'pt-BR': 'Fale curto.' });
    expect(renderPrompt(getConfig().devCycle, 'rules.chat', 'pt-BR')).toBe('Fale curto.');
    h.get('config:prompt-set')!('rules.chat', 'pt-BR', null);
    expect(getConfig().devCycle.promptOverrides).toEqual({});
    expect(renderPrompt(getConfig().devCycle, 'rules.chat', 'pt-BR')).toBe(before);
    expect((h.get('config:prompts')!() as PromptEntry[]).length).toBe(promptIds().length);
  });

  it('refuses a language the schema does not have, and leaves the stored config as it was', () => {
    saveConfig(neutralConfig());
    expect(() => handlers().get('config:prompt-set')!('rules.chat', 'fr', 'x')).toThrow();
    expect(getConfig().devCycle.promptOverrides).toEqual({});
  });

  it('keeps both channels off a paired browser, with or without the external-effects switch', () => {
    for (const channel of ['config:prompts', 'config:prompt-set']) {
      expect(webAccess(channel), channel).toBe('deny');
      expect(webRefusal(channel, true), channel).not.toBeNull();
    }
    expect(webAccess('config:get')).toBe('allow');
  });
});
