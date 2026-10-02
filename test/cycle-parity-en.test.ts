import { vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { applyTemplate, builtInTemplate } from '../src/shared/cycles';
import { fakeVcs } from './helpers/promptCapture';
import { parity } from './helpers/parity';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));
vi.mock('../src/main/vcs', async (orig) => ({ ...(await orig<typeof import('../src/main/vcs')>()), vcsProvider: () => fakeVcs, vcsReady: () => true }));

// The English counterpart of the legacy parity run: the same ceremonies for a person named Ana on the generic SDD template, in English.
// The golden is the text the agents are told and the files the app writes for people (GATE_QUIZ.md, QA_CHECKLIST.md, the plan's log line):
// changing a word of an English prompt changes it, on purpose, and `UPDATE_GOLDEN=1 npx vitest run test/cycle-parity-en*.test.ts` rewrites it.
async function setup(): Promise<void> {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = applyTemplate(neutralConfig(), builtInTemplate('sdd')!);
  c.language = 'en';
  c.userName = 'Ana';
  c.voice.enabled = true;
  // What the machine happens to have in ~/.claude must not change what the agents are told.
  c.docs.autoDetect = false;
  saveConfig(c);
}

parity('English golden, voice on: every ceremony in English for Ana on the generic SDD template', 'en-prompts.json', { voice: true, setup, registro: 'Decision log' });
