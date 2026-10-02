import type { Card } from '../../shared/types';
import type { DiscussionView, DiscussionsResult, MrPath, ProposalView, Reentry } from '../../shared/feedback';
import { api } from './api';

export const feedbackApi = {
  getReentry: (iid: string) => api.invoke<Reentry | null>('feedback:reentry:get', iid),
  prepareReentry: (card: Card) => api.invoke<Reentry>('feedback:reentry:prepare', card),
  askReentry: (iid: string, question: string) => api.invoke<Reentry>('feedback:reentry:ask', iid, question),
  listDiscussions: (mr: MrPath) => api.invoke<DiscussionsResult>('feedback:discussions:list', mr),
  explainDiscussion: (card: Card, mr: MrPath, id: string) => api.invoke<DiscussionView>('feedback:discussions:explain', card, mr, id),
  replyDiscussion: (card: Card, mr: MrPath, id: string, body: string) => api.invoke<ProposalView>('feedback:discussions:reply', card, mr, id, body),
  resolveDiscussion: (card: Card, mr: MrPath, id: string) => api.invoke<ProposalView>('feedback:discussions:resolve', card, mr, id),
};
