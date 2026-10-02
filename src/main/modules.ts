import type { Module } from './module';
import { register as radar } from './radar';

// Feature modules register here, one line each. Keep this list sorted.
export const MODULES: Module[] = [
  radar,
];
