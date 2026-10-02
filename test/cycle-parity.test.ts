import { vi } from 'vitest';
import { fakeVcs } from './helpers/promptCapture';
import { parity } from './helpers/parity';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));
vi.mock('../src/main/vcs', async (orig) => ({ ...(await orig<typeof import('../src/main/vcs')>()), vcsProvider: () => fakeVcs, vcsReady: () => true }));

parity('legacy parity, voice on: the migrated user gets the prompts and files the app produced before the cycle templates', 'legacy-prompts.json', { voice: true });
