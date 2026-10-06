import { agentPrep } from './agentPrep';
import { autostart } from './autostart';
import { custoTempo } from './custo-tempo';
import { register as auditoria } from './auditoria';
import { register as ceremonyCommands } from './ceremonyCommands';
import { configModule } from './configModule';
import { register as conflictVerify } from './conflictVerify';
import { cycleModule } from './cycle';
import { register as diagramFix } from './diagramFix';
import { register as efeitos } from './efeitos';
import { errorlog } from './errorlog';
import { register as feedback } from './feedback';
import { forumModule } from './forum';
import { register as gitlabQuick } from './gitlabQuick';
import { register as glossary } from './glossary';
import { minutes } from './minutes';
import { mentionsModule } from './mentions/module';
import { pluginsModule } from './plugins/module';
import { register as radar } from './radar';
import { register as watchers } from './watchers';
import { retention } from './retention';
import { runsModule } from './runner/module';
import { suggestionsModule } from './suggestionsModule';
import { saude } from './saude';
import { update } from './update';
import { updates } from './updates';
import { vcsModule } from './vcs/module';
import { voiceModule } from './voiceModule';
import { wizard } from './wizard';
import { workspaces } from './workspaces';
import type { Module } from './module';

// Feature modules register here, one per line. Keep this list sorted.
const ALL: Module[] = [
  agentPrep,
  auditoria,
  autostart,
  ceremonyCommands,
  configModule,
  conflictVerify,
  cycleModule,
  custoTempo,
  diagramFix,
  efeitos,
  errorlog,
  feedback,
  forumModule,
  gitlabQuick,
  glossary,
  mentionsModule,
  minutes,
  pluginsModule,
  radar,
  retention,
  runsModule,
  saude,
  suggestionsModule,
  update,
  updates,
  vcsModule,
  voiceModule,
  watchers,
  wizard,
  workspaces,
];

/**
 * Everything the app registers, and the one list a check can read. A module that is written but missing here is never registered: its channels and its
 * subscriptions do not exist when the app runs, whatever its own file says (the mentions of a forum thread that is not a run's live or die here).
 */
export const moduleList = (): Module[] => ALL;

/** The same list, as the app uses it. */
export const MODULES: Module[] = moduleList();
