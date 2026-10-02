import { register as auditoria } from './auditoria';
import { custoTempo } from './custo-tempo';
import { register as efeitos } from './efeitos';
import { register as feedback } from './feedback';
import { register as gitlabQuick } from './gitlabQuick';
import { register as radar } from './radar';
import { register as watchers } from './watchers';
import { retention } from './retention';
import { saude } from './saude';
import type { Module } from './module';

// Feature modules register here, one per line. Keep this list sorted.
export const MODULES: Module[] = [
  auditoria,
  custoTempo,
  efeitos,
  feedback,
  gitlabQuick,
  radar,
  retention,
  saude,
  watchers,
];
