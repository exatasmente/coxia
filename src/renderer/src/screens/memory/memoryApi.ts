import type { MemoryListView, NoteGet, NotePatch, NoteRemove, NoteWrite } from '../../../../shared/memoryView';
import { api } from '../../api';

// The channels of the Memory view (`memory:*`). All six are open to a paired browser: the phone has the same capabilities as the window over the memory (webPolicy.ts).

export const memoryApi = {
  list: () => api.invoke<MemoryListView>('memory:list'),
  read: (conversation: string, agent: string, id: string) => api.invoke<NoteGet>('memory:read', conversation, agent, id),
  save: (conversation: string, agent: string, id: string, revision: number, patch: NotePatch) => api.invoke<NoteWrite>('memory:save', conversation, agent, id, revision, patch),
  review: (conversation: string, agent: string, id: string) => api.invoke<NoteWrite>('memory:review', conversation, agent, id),
  remove: (conversation: string, agent: string, id: string) => api.invoke<NoteRemove>('memory:remove', conversation, agent, id),
  removeFolder: (conversation: string, agent?: string) => api.invoke<NoteRemove>('memory:remove-folder', conversation, agent),
};
