import { vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { applyTemplate, builtInTemplate } from '../src/shared/cycles';
import { fakeVcs } from './helpers/promptCapture';
import { parity } from './helpers/parity';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));
vi.mock('../src/main/vcs', async (orig) => ({ ...(await orig<typeof import('../src/main/vcs')>()), vcsProvider: () => fakeVcs, vcsReady: () => true }));

// The same English golden with voice off: the ceremonies are a text conversation, so nothing says "voice", "heard" or "speak".
async function setup(): Promise<void> {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = applyTemplate(neutralConfig(), builtInTemplate('sdd')!);
  c.language = 'en';
  c.userName = 'Ana';
  c.voice.enabled = false;
  c.docs.autoDetect = false;
  saveConfig(c);
}

parity('English golden, voice off: the same ceremonies in text', 'en-prompts-novoice.json', { voice: false, setup, registro: 'Decision log' });
