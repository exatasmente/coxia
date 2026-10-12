// A spoken turn tells the persona to answer for listening, in both languages, and a typed turn's prompt does not move. Whether a real model follows it is checked by
// hand; the Markdown cleanup before synthesis stays the safety net either way.
import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { ForumMessage } from '../src/shared/forum';
import en from '../src/shared/i18n/main.en.json';
import ptBR from '../src/shared/i18n/main.pt-BR.json';
import { mentionCall } from '../src/main/mentions/call';
import { updateConfig } from '../src/main/workspaceConfig';

const KEY = 'prompt.sdd.runner.mention.persona.voice';
const persona = newAgent({ id: 'me', name: 'Me', kind: 'persona' });
const post: ForumMessage = { v: 1, type: 'message', seq: 2, thread: 'agent-me', at: '2026-10-03T10:00:00.000Z', kind: 'post', author: { type: 'person' }, text: 'what is open', code: null, params: {}, mentions: [], refs: [], attachments: [], stage: null, to: null, replyTo: null, public: false, waitsForAnswer: false, published: null, origin: 'voice' };

function system(language: 'en' | 'pt-BR', voice: boolean | undefined): string {
  const config = neutralConfig();
  config.language = language;
  config.agents.team = [...config.agents.team, persona];
  updateConfig(() => config);
  const p = voice === undefined ? { buttons: true, tools: true } : { buttons: true, tools: true, voice };
  return mentionCall({ agent: persona, config, message: post, thread: [], files: [], cwd: '/tmp', place: 'general', persona: p }).system ?? '';
}

describe('the voice line of the persona', () => {
  for (const [language, catalog, marker] of [
    ['en', en, 'never take a spoken "yes"'],
    ['pt-BR', ptBR, 'nunca tome um "sim" falado'],
  ] as const) {
    it(`is in the system text of a spoken turn (${language})`, () => {
      const line = (catalog as Record<string, string>)[KEY];
      expect(line).toContain(marker);
      expect(system(language, true)).toContain(marker);
    });

    it(`leaves a typed turn exactly as before (${language})`, () => {
      const typed = system(language, false);
      expect(typed).not.toContain(marker);
      expect(typed).toBe(system(language, undefined));
    });
  }

  it('asks for no Markdown and announces a long action, without the word call', () => {
    for (const line of [en[KEY], ptBR[KEY]]) expect(line).not.toMatch(/\bcalls?\b/i);
    expect(en[KEY]).toMatch(/No Markdown/);
    expect(en[KEY]).toMatch(/one moment/);
    expect(ptBR[KEY]).toMatch(/Sem Markdown/);
  });
});
