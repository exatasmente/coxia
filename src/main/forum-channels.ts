import { cycleText } from '../shared/cycles/text';
import type { AgentDef, Language, SquadDef } from '../shared/config/types';
import { MAX_TITLE, SQUADS_CHANNEL, agentThreadId, squadChannelId } from '../shared/forum';
import { createTranslator } from '../shared/i18n';
import type { AttachmentStore } from './attachments';
import type { ForumStore } from './forum-core';

// The channels of the squads: one per squad (its general talk; its runs' threads are listed under it) and the one the squads talk to each other in. They are
// ordinary threads of the forum (kind `channel`), made when a workspace has squads and left alone when it has none. The direct conversation of an agent is
// made the same way, one per agent of the team (kind `agent`). Electron-free.

export function ensureSquadChannels(forum: ForumStore, squads: SquadDef[], language: Language): void {
  if (!squads.length) return;
  const tr = createTranslator(language);
  forum.ensureThread({ id: SQUADS_CHANNEL, kind: 'channel', squad: null, title: tr('main.forum.squadsTitle') });
  for (const s of squads) forum.ensureThread({ id: squadChannelId(s.id), kind: 'channel', squad: s.id, title: cycleText(s.name || s.id, language).slice(0, MAX_TITLE) });
}

/** The direct conversation of an agent (`agent-<id>`), made on the first look at the forum. Idempotent: an agent keeps the one it has. */
export function ensureAgentThread(forum: ForumStore, agent: Pick<AgentDef, 'id' | 'name'>, language: Language): void {
  const tr = createTranslator(language);
  const name = cycleText(agent.name || agent.id, language).slice(0, MAX_TITLE);
  forum.ensureThread({ id: agentThreadId(agent.id), kind: 'agent', squad: agent.id, title: tr('main.forum.agentTitle', { agent: name }) });
}

/**
 * Deletes the direct conversation of an agent and the files it holds. Only a conversation of kind `agent` goes: the store can delete any thread, and this is the
 * door that keeps a run's thread, a general one and a channel out of its reach. The files go first, so a call that was cut short is finished by the next one. True when
 * there was a conversation to delete. `beforeDelete` is told the thread's id first, so what is open on it can be ended.
 */
export function deleteAgentThread(forum: ForumStore, attachments: Pick<AttachmentStore, 'dropThread'>, agentId: string, beforeDelete?: (thread: string) => void): boolean {
  const id = agentThreadId(agentId);
  if (forum.summary(id)?.kind !== 'agent') return false;
  // The screen an agent has open in this conversation goes with it (the recording of a conversation that is gone is kept nowhere).
  beforeDelete?.(id);
  attachments.dropThread(id);
  forum.deleteThread(id);
  return true;
}
