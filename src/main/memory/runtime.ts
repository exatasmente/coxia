import { recordWrite } from '../auditoria';
import { secretPath } from '../agents';
import { ATAS } from '../env';
import { logError } from '../errorlog';
import { runStore } from '../runs';
import { createSharedMemory } from '../runner/activities';
import { getConfig } from '../workspaceConfig';
import { createFacts, type Facts } from './facts';
import { memoryStore } from './instance';
import { createMemoryIndex, type MemoryIndex } from './index';
import { createMemoryPort, type MemoryPort } from './port';

// The index and the door of the running workspace's memory, over its own folder: one for the process, as the store and the procedures' port are. What the calls ask for their
// memory goes through `memoryPort()`; it answers null while the workspace's switch is off. Kept apart from `instance.ts` so the screens' channels, which work whatever the
// switch says, do not load the agents' side.

let facts: Facts | null = null;
let index: MemoryIndex | null = null;
let port: MemoryPort | null = null;

/** The version and the roadmap of the running workspace (the app reads them; an agent never runs git for them). */
export function memoryFacts(): Facts {
  facts ??= createFacts({ config: getConfig, secret: (p) => secretPath(p) });
  return facts;
}

export function memoryIndex(): MemoryIndex {
  index ??= createMemoryIndex({ store: memoryStore(), runs: runStore(), activities: createSharedMemory(ATAS), facts: memoryFacts(), language: () => getConfig().language });
  return index;
}

export const memoryPort = (): MemoryPort => (port ??= createMemoryPort({ config: getConfig, store: memoryStore(), index: memoryIndex(), audit: recordWrite, onError: logError }));
