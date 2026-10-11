// No screen is called Today any more: its content is the Overview and the app opens on the chat. A label that names the screen that is gone would send the person looking for
// it, so no `ui.*` text says "Today" or "Hoje" unless it is about the content (the day's time, the cards of the day, the cost of today), which is allowlisted by key.
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/shared/i18n';
import personaEn from '../src/shared/i18n/ui-persona.en.json';
import personaPtBR from '../src/shared/i18n/ui-persona.pt-BR.json';

/** Keys whose "Today" is the day and not the screen. `ui.today.*` is the Overview's own content; `ui.cost.*` is the cost screen's rows. */
const CONTENT = [/^ui\.today\./, /^ui\.cost\./, /^ui\.actions\.diff\./];

const NAMES: Record<'en' | 'pt-BR', RegExp> = { en: /\bToday\b/, 'pt-BR': /\bHoje\b/ };

describe('the words of the screens', () => {
  for (const language of ['en', 'pt-BR'] as const) {
    it(`say nothing in ${language} that names the screen that is gone`, () => {
      const naming = Object.entries(CATALOGS[language])
        .filter(([key, value]) => key.startsWith('ui.') && NAMES[language].test(value) && !CONTENT.some((c) => c.test(key)))
        .map(([key, value]) => `${key}: ${value}`);
      expect(naming).toEqual([]);
    });
  }

  it('keep a back button that says Home, not the screen it used to go to', () => {
    for (const key of ['ui.nav.backToday', 'ui.actions.backToday', 'ui.quick.backToday', 'ui.call.backToToday', 'ui.settings.back', 'ui.help.back']) {
      expect(CATALOGS.en[key], key).toBe('Back to Home');
      expect(CATALOGS['pt-BR'][key], key).toBe('Voltar ao início');
    }
  });

  it('give the first item of the bar the chat\'s name, and nothing is left of the old item', () => {
    expect(CATALOGS.en['ui.nav.chat']).toBe('Chat');
    expect(CATALOGS['pt-BR']['ui.nav.chat']).toBeTruthy();
    expect(CATALOGS.en['ui.nav.today']).toBeUndefined();
    expect(CATALOGS['pt-BR']['ui.nav.today']).toBeUndefined();
  });

  it('have every key of the persona catalogs in both languages, and in the merged catalogs of both', () => {
    expect(Object.keys(personaPtBR).sort()).toEqual(Object.keys(personaEn).sort());
    for (const key of Object.keys(personaEn)) {
      expect(CATALOGS.en[key], key).toBeTruthy();
      expect(CATALOGS['pt-BR'][key], key).toBeTruthy();
    }
  });
});
