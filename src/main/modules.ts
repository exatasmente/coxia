import { autostart } from './autostart';
import { custoTempo } from './custo-tempo';
import { register as auditoria } from './auditoria';
import { register as efeitos } from './efeitos';
import { register as feedback } from './feedback';
import { register as gitlabQuick } from './gitlabQuick';
import { register as glossary } from './glossary';
import { register as radar } from './radar';
import { register as watchers } from './watchers';
import { retention } from './retention';
import { saude } from './saude';
import type { Module } from './module';

// Feature modules register here, one per line. Keep this list sorted.
export const MODULES: Module[] = [
  auditoria,
  autostart,
  custoTempo,
  efeitos,
  feedback,
  gitlabQuick,
  glossary,
  radar,
  retention,
  saude,
  watchers,
];
