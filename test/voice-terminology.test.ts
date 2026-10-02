// "Call" while voice is on, "conversa" (pt-BR) / "chat" (en) while it is off: through keys and a voice-aware translator, never a string replace.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGS, NOVOICE_SUFFIX, createVoiceTranslator, setLanguage, setVoiceEnabled, t, tv, voiceEnabled } from '../src/shared/i18n';
import { agoraPlan } from '../src/renderer/src/dashboard';
import { answeredText, callWord, chatRules, heardText, modeText, roleText, speechRules } from '../src/main/agentVoice';
import { classify } from '../src/main/custo-core';
import { appPromptKind } from '../src/main/retention-core';
import { entryOf } from '../src/main/sessions-core';

const ROOT = join(import.meta.dirname, '..');
const CALL_WORD = /\bcalls?\b/i;

afterEach(() => {
  setLanguage('pt-BR');
  setVoiceEnabled(true);
});

describe('the catalogs', () => {
  const variants = Object.keys(CATALOGS['pt-BR']).filter((k) => k.endsWith(NOVOICE_SUFFIX));

  it('have a voice-off variant for the wording of the call, in both languages', () => {
    expect(variants.length).toBeGreaterThan(20);
    for (const lang of ['pt-BR', 'en'] as const) for (const key of variants) expect(CATALOGS[lang][key], `${lang} ${key}`).toBeTruthy();
  });

  it('every variant belongs to a key that exists, and keeps its placeholders', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const lang of ['pt-BR', 'en'] as const) {
      for (const key of variants) {
        const base = key.slice(0, -NOVOICE_SUFFIX.length);
        expect(CATALOGS[lang][base], `${lang} ${base}`).toBeTruthy();
        expect(holes(CATALOGS[lang][key]), `${lang} ${key}`).toEqual(holes(CATALOGS[lang][base]));
      }
    }
  });

  it('never say "call" in the voice-off variants, and say it in the voice ones that are about the call', () => {
    for (const lang of ['pt-BR', 'en'] as const) {
      for (const key of variants) expect(CATALOGS[lang][key], `${lang} ${key}`).not.toMatch(CALL_WORD);
    }
    for (const base of ['nav.call', 'call.enter', 'call.back', 'call.controls', 'call.inProgress', 'call.after', 'notify.preDaily.body', 'outbox.reply']) {
      for (const lang of ['pt-BR', 'en'] as const) expect(CATALOGS[lang][base], `${lang} ${base}`).toMatch(CALL_WORD);
    }
  });

  it('turn every "call" into "conversa" in pt-BR and "chat" in English, consistently', () => {
    for (const key of variants) {
      const base = key.slice(0, -NOVOICE_SUFFIX.length);
      if (CALL_WORD.test(CATALOGS['pt-BR'][base])) expect(CATALOGS['pt-BR'][key].toLowerCase(), key).toMatch(/conversa/);
      if (CALL_WORD.test(CATALOGS.en[base])) expect(CATALOGS.en[key].toLowerCase(), key).toMatch(/\bchat\b/);
      expect(CATALOGS.en[key].toLowerCase(), key).not.toMatch(/conversation/);
    }
  });
});

describe('tv', () => {
  it.each([
    ['pt-BR', true, 'Entrar na call'],
    ['pt-BR', false, 'Entrar na conversa'],
    ['en', true, 'Join the call'],
    ['en', false, 'Join the chat'],
  ] as const)('%s with voice %s: %s', (language, voice, expected) => {
    setLanguage(language);
    setVoiceEnabled(voice);
    expect(tv('call.enter')).toBe(expected);
  });

  it('gives the main labels in every language and voice state', () => {
    const table: Record<string, Record<string, string>> = {
      'pt-BR/voice': { 'nav.call': 'Call', 'call.back': 'Voltar à call', 'call.controls': 'Controles da call', 'call.inProgress': 'Call em andamento', 'notify.preDaily.body': 'Os agentes estão prontos para a call. Clique para entrar.' },
      'pt-BR/text': { 'nav.call': 'Conversa', 'call.back': 'Voltar à conversa', 'call.controls': 'Controles da conversa', 'call.inProgress': 'Conversa em andamento', 'notify.preDaily.body': 'Os agentes estão prontos para a conversa. Clique para entrar.' },
      'en/voice': { 'nav.call': 'Call', 'call.back': 'Back to the call', 'call.controls': 'Call controls', 'call.inProgress': 'Call in progress', 'notify.preDaily.body': 'The agents are ready for the call. Click to join.' },
      'en/text': { 'nav.call': 'Chat', 'call.back': 'Back to the chat', 'call.controls': 'Chat controls', 'call.inProgress': 'Chat in progress', 'notify.preDaily.body': 'The agents are ready for the chat. Click to join.' },
    };
    for (const [state, labels] of Object.entries(table)) {
      const [language, mode] = state.split('/');
      setLanguage(language as 'pt-BR' | 'en');
      setVoiceEnabled(mode === 'voice');
      for (const [key, text] of Object.entries(labels)) expect(tv(key), `${state} ${key}`).toBe(text);
    }
  });

  it('leaves a key without a variant alone, and does not touch t()', () => {
    setVoiceEnabled(false);
    expect(tv('settings.title')).toBe('Configurações');
    expect(t('call.enter')).toBe('Entrar na call');
    expect(tv('nobody.has.this')).toBe('nobody.has.this');
  });

  it('keeps the placeholders of the variant', () => {
    setVoiceEnabled(false);
    expect(tv('call.opening', { total: 5, blocked: 2 })).toMatch(/^Bom dia\. São 5 atividades, 2 com bloqueio\..*digite/);
    setVoiceEnabled(true);
    expect(tv('call.opening', { total: 5, blocked: 2 })).toMatch(/aperte espaço/);
  });

  it('falls back to pt-BR for a variant the language lacks', () => {
    const catalogs = { 'pt-BR': { a: 'call', 'a.novoice': 'conversa' }, en: { a: 'call' } };
    expect(createVoiceTranslator('en', false, catalogs)('a')).toBe('conversa');
    expect(createVoiceTranslator('en', true, catalogs)('a')).toBe('call');
  });

  it('starts with voice on, and the main process takes the state from the config', () => {
    expect(voiceEnabled()).toBe(true);
  });
});

describe('the screens that compute a label', () => {
  const base = { hasCards: true, loadingCards: false, startedAt: 1, callEnded: false, saved: false, resumed: false, ready: 2, total: 5, decisions: 0, effects: 0, retroDue: false };

  it('the "Agora" card says call with voice and conversa without', () => {
    expect(agoraPlan(base).title).toBe('Call em andamento');
    expect(agoraPlan(base).primary.label).toBe('Voltar à call');
    setVoiceEnabled(false);
    expect(agoraPlan(base).title).toBe('Conversa em andamento');
    expect(agoraPlan(base).primary.label).toBe('Voltar à conversa');
    setLanguage('en');
    expect(agoraPlan(base).primary.label).toBe('Back to the chat');
  });
});

describe('the agent prompts', () => {
  it('speak of voice only while it is on', () => {
    setVoiceEnabled(true);
    expect(speechRules()).toMatch(/falado/);
    expect(roleText()).toMatch(/cerimônia por voz/);
    expect(chatRules()).toMatch(/para ser ouvida/);
    expect(modeText()).toBe('por voz');
    expect(heardText()).toBe('transcrição por voz');
    expect(callWord()).toBe('Call');
    setVoiceEnabled(false);
    expect(speechRules()).toMatch(/voz está desligada/);
    expect(speechRules()).not.toMatch(/falado/);
    expect(roleText()).not.toMatch(/por voz/);
    expect(chatRules()).not.toMatch(/para ser ouvida/);
    expect(modeText()).toBe('em texto');
    expect(heardText()).toBe('texto digitado');
    expect(callWord()).toBe('Conversa');
    expect(answeredText()).toBe('por escrito');
  });

  it('still identify the prompts the app sends in either mode (cost, retention and session index)', () => {
    for (const voice of [true, false]) {
      setVoiceEnabled(voice);
      const prompts: [string, string, string][] = [
        [`Desbloqueio ${modeText()} da atividade sz4#1. Investigue`, 'deep', 'desbloqueio'],
        [`${callWord()} sobre um conflito de sincronização com a main depois de uma release.`, 'release', 'sincronização com a release'],
        [`${callWord()} de reentrada da issue sz4#1 (t), ${modeText()}: o QA`, 'reentry', 'reentrada'],
        [`Retro semanal do Luiz, ${modeText()}, de 1 a 2.`, 'retro', 'retro'],
        [`O Luiz respondeu ${answeredText()}: «ok»`, 'reply', 'fala do agente'],
      ];
      for (const [prompt, cost, kind] of prompts) {
        if (cost !== 'reentry' && cost !== 'reply') expect(classify(prompt), `${voice} ${prompt}`).not.toBeNull();
        expect(appPromptKind(prompt), `${voice} ${prompt}`).toBe(kind);
      }
      expect(entryOf('s', 'deep', `${callWord()} de reentrada da issue sz4#7 (t), ${modeText()}: o QA`).ref).toBe('sz4#7');
      expect(entryOf('s', 'deep', `Desbloqueio ${modeText()} da atividade sz4#8. Investigue`).ref).toBe('sz4#8');
    }
  });
});

describe('the sources', () => {
  function* files(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* files(path);
      else if (/\.tsx?$/.test(name)) yield path;
    }
  }

  it('keep no literal "call" wording on the screens: it comes from the catalog', () => {
    const literal = /['"`>](?:Entrar na call|Voltar à call|Depois da call|Controles da call|Call em andamento|Abrir call)/;
    for (const dir of ['src/renderer/src', 'src/main']) {
      for (const file of files(join(ROOT, dir))) expect(readFileSync(file, 'utf8'), file).not.toMatch(literal);
    }
  });
});
