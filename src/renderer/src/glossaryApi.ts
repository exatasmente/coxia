import type { Term } from '../../shared/glossary';
import { api } from './api';

export const glossaryApi = {
  get: () => api.invoke<{ terms: Term[]; defaults: Term[] }>('glossary:get'),
  save: (terms: Term[]) => api.invoke<Term[]>('glossary:save', terms),
  learn: (heard: string, term: string) => api.invoke<Term[]>('glossary:learn', heard, term),
  hear: (text: string, terms: Term[]) => api.invoke<ArrayBuffer>('glossary:hear', text, terms),
};
