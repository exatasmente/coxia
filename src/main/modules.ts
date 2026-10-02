import { custoTempo } from './custo-tempo';
import { register as feedback } from './feedback';
import { register as gitlabQuick } from './gitlabQuick';
import type { Module } from './module';

// Feature modules register here, one per line. Keep this list sorted.
export const MODULES: Module[] = [
  custoTempo,
  feedback,
  gitlabQuick,
];
