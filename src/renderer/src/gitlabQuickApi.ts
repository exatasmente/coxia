import type { QuickContext, QuickMember, QuickRequest, QuickResult } from '../../shared/gitlabQuick';
import type { Card } from '../../shared/types';
import { api } from './api';

export const quickApi = {
  context: (card: Card) => api.invoke<QuickContext>('gitlabQuick:context', card),
  members: (projectPath: string) => api.invoke<QuickMember[]>('gitlabQuick:members', projectPath),
  propose: (req: QuickRequest) => api.invoke<QuickResult>('gitlabQuick:propose', req),
};
