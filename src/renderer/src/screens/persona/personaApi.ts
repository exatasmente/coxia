import type { PoolMode, AgentModel } from '../../../../shared/config/types';
import { api } from '../../api';
import type { RoundResult } from '../team/assistEdit';
import type { PersonaChannelInput, PersonaDraftInput, PersonaReviewResult } from './personaWizardModel';

// The persona's channels. Unlike the agent assistant's, they are open to a paired browser: a phone makes, adjusts, tests, clears and deletes the persona exactly as the
// window does, and what they throw is already worded for the person.

export interface PersonaSaveInput {
  name: string;
  job: string;
  instructions: string;
  model: AgentModel;
  poolMode: PoolMode | null;
}

export const personaApi = {
  round: (input: PersonaChannelInput) => api.invoke<RoundResult>('persona:round', input),
  review: (input: PersonaChannelInput) => api.invoke<PersonaReviewResult>('persona:review', input),
  saveDraft: (input: PersonaDraftInput) => api.invoke<{ id: string }>('persona:saveDraft', input),
  conclude: (id: string) => api.invoke<{ id: string }>('persona:conclude', id),
  discard: (id: string) => api.invoke<{ id: string }>('persona:discard', id),
  finish: (input: { id: string; from?: string }) => api.invoke<{ id: string }>('persona:finish', input),
  save: (input: PersonaSaveInput) => api.invoke<{ id: string }>('persona:save', input),
  clear: () => api.invoke<{ id: string }>('persona:clear'),
  delete: () => api.invoke<{ id: string }>('persona:delete'),
};
