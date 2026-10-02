import { vi } from 'vitest';
import { fakeVcs } from './helpers/promptCapture';
import { parity } from './helpers/parity';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));
vi.mock('../src/main/vcs', async (orig) => ({ ...(await orig<typeof import('../src/main/vcs')>()), vcsProvider: () => fakeVcs, vcsReady: () => true }));

parity('legacy parity, voice off: the same ceremonies in text', 'legacy-prompts-novoice.json', { voice: false });
