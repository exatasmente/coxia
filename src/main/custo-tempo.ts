import { custo } from './custo';
import type { Module } from './module';
import { tempo } from './tempo';

// Cost panel and time-per-issue export are registered together, so modules.ts takes a single entry.
export const custoTempo: Module = (ctx) => {
  custo(ctx);
  tempo(ctx);
};
