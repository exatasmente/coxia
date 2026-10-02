import { autostart } from './autostart';
import { custoTempo } from './custo-tempo';
import { register as feedback } from './feedback';
import { register as gitlabQuick } from './gitlabQuick';
import { register as radar } from './radar';
import { register as watchers } from './watchers';
import type { Module } from './module';

// Feature modules register here, one per line. Keep this list sorted.
export const MODULES: Module[] = [
  autostart,
  custoTempo,
  feedback,
  gitlabQuick,
  radar,
  watchers,
];
