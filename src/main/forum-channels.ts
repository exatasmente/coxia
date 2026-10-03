import { cycleText } from '../shared/cycles/text';
import type { Language, SquadDef } from '../shared/config/types';
import { MAX_TITLE, SQUADS_CHANNEL, squadChannelId } from '../shared/forum';
import { createTranslator } from '../shared/i18n';
import type { ForumStore } from './forum-core';

// The channels of the squads: one per squad (its general talk; its runs' threads are listed under it) and the one the squads talk to each other in. They are
// ordinary threads of the forum (kind `channel`), made when a workspace has squads and left alone when it has none. Electron-free.

export function ensureSquadChannels(forum: ForumStore, squads: SquadDef[], language: Language): void {
  if (!squads.length) return;
  const tr = createTranslator(language);
  forum.ensureThread({ id: SQUADS_CHANNEL, kind: 'channel', squad: null, title: tr('main.forum.squadsTitle') });
  for (const s of squads) forum.ensureThread({ id: squadChannelId(s.id), kind: 'channel', squad: s.id, title: cycleText(s.name || s.id, language).slice(0, MAX_TITLE) });
}
