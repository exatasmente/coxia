import { afterEach, describe, expect, it } from 'vitest';
import { classify, firstPromptOf, gensOf } from '../src/main/custo-core';
import { appPromptKind, selectRetention } from '../src/main/retention-core';
import { entryOf } from '../src/main/sessions-core';
import { neutralConfig } from '../src/shared/config';
import type { Language } from '../src/shared/config/types';
import { agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { CATALOGS, setLanguage, setVoiceEnabled } from '../src/shared/i18n';

// The session the agent assistant leaves behind (the `noteSession` of both engines) is told apart by its first prompt, like the app's other sessions: the cost screen
// counts it as "assist" and the retention sweep lists it as one of the app's. The prompts here are the ones the assistant really sends, not a copy.

const { saveConfig } = await import('../src/main/workspaceConfig');
const core = await import('../src/main/agentAssist-core');

const LANGUAGES: Language[] = ['pt-BR', 'en'];
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T12:00:00.000Z');

afterEach(() => {
  setLanguage('pt-BR');
  setVoiceEnabled(true);
});

function sent(language: Language): { round: string; review: string } {
  const c = applyTemplate(neutralConfig(), agentFlowEngineering);
  c.language = language;
  const config = saveConfig(c);
  const context = core.assistContext(config, true);
  const input = { mode: 'create' as const, request: 'An agent that writes release notes.', rounds: [], draft: { name: '', job: '', instructions: '' }, original: null, test: '', note: '' };
  return { round: core.roundPrompt(input, context), review: core.reviewPrompt(input, context) };
}

describe('a session the assistant opened', () => {
  for (const language of LANGUAGES) {
    for (const voice of [true, false]) {
      it(`is "assist" in the cost screen and in the session index, in ${language} with voice ${voice ? 'on' : 'off'}`, () => {
        setVoiceEnabled(voice);
        const { round, review } = sent(language);
        for (const prompt of [round, review]) {
          expect(classify(prompt)).toBe('assist');
          expect(entryOf('s1', 'deep', prompt)).toMatchObject({ kind: 'assist', ref: null });
        }
      });
    }

    it(`is one of the app's sessions for the retention, with its own label, in ${language}`, () => {
      const { round, review } = sent(language);
      setLanguage(language);
      const label = CATALOGS[language]['main.retention.app.assist'];
      expect(label).toBeTruthy();
      expect(appPromptKind(round)).toBe(label);
      expect(appPromptKind(review)).toBe(label);
    });
  }

  it('reads its calls from the transcript the engines write', () => {
    const { round } = sent('en');
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: round } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-02T11:00:00.000Z', message: { id: 'gen-1', model: 'm', content: [{ type: 'text', text: '{}' }] } }),
    ];
    const kind = classify(firstPromptOf(lines) ?? '');
    expect(kind).toBe('assist');
    expect(gensOf(lines, kind as 'assist', 's1').map((g) => [g.id, g.kind, g.session])).toEqual([['gen-1', 'assist', 's1']]);
  });

  it('is removed by the retention once old, and says it is the assistant\'s', () => {
    const { round, review } = sent('en');
    setLanguage('en');
    const old = NOW - 40 * DAY;
    const file = (sessionId: string, firstPrompt: string) => ({ kind: 'sessoes' as const, path: `/t/${sessionId}.jsonl`, size: 1, mtimeMs: old, sessionId, firstPrompt, entrypoints: ['sdk-ts'] });
    const sel = selectRetention([file('r', round), file('v', review), file('own', 'Explain what this file does')], [], { now: NOW, days: 30 });
    expect(sel.remove.map((v) => v.file.sessionId)).toEqual(['r', 'v']);
    for (const v of sel.remove) expect(v.reason).toContain(CATALOGS.en['main.retention.app.assist']);
    expect(sel.keep.map((v) => [v.file.sessionId, v.reason])).toEqual([['own', CATALOGS.en['main.retention.notAppPrompt']]]);
  });

  it('keeps it when it was continued outside the app, as any other session of the app', () => {
    const { round } = sent('en');
    setLanguage('en');
    const file = { kind: 'sessoes' as const, path: '/t/c.jsonl', size: 1, mtimeMs: NOW - 40 * DAY, sessionId: 'c', firstPrompt: round, entrypoints: ['sdk-ts', 'cli'] };
    const sel = selectRetention([file], [], { now: NOW, days: 30 });
    expect(sel.remove).toEqual([]);
    expect(sel.keep[0].reason).toMatch(/cli/);
  });
});

describe('the sessions that are not the assistant\'s', () => {
  it('are classified as they were', () => {
    setLanguage('pt-BR');
    const prompts: [string, string | null][] = [
      ['Gate 1 da issue web#104, quiz', 'gate'],
      ['Escreva o texto que o Bruno vai colar no chat do time', 'teams'],
      ['Retro semanal do Bruno, em texto, de 1 a 2.', 'retro'],
      ['Explain what this file does', null],
      ['Write the next function for me', null],
      ['Review this change and write the tests', null],
      ['', null],
    ];
    for (const [prompt, kind] of prompts) expect(classify(prompt), prompt).toBe(kind);
    expect(appPromptKind('Explain what this file does')).toBeNull();
    expect(appPromptKind('Gate 1 da issue web#104, quiz')).toBe(CATALOGS['pt-BR']['main.retention.app.gate']);
  });
});
