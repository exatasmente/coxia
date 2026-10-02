import { autostart } from './autostart';
import { custoTempo } from './custo-tempo';
import { register as auditoria } from './auditoria';
import { register as conflictVerify } from './conflictVerify';
import { register as diagramFix } from './diagramFix';
import { register as efeitos } from './efeitos';
import { register as feedback } from './feedback';
import { register as gitlabQuick } from './gitlabQuick';
import { register as glossary } from './glossary';
import { register as radar } from './radar';
import { register as watchers } from './watchers';
import { retention } from './retention';
import { saude } from './saude';
import { update } from './update';
import { workspaces } from './workspaces';
import type { Module } from './module';

// Feature modules register here, one per line. Keep this list sorted.
export const MODULES: Module[] = [
  auditoria,
  autostart,
  conflictVerify,
  custoTempo,
  diagramFix,
  efeitos,
  feedback,
  gitlabQuick,
  glossary,
  radar,
  retention,
  saude,
  update,
  watchers,
  workspaces,
];
