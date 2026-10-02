import type { Module } from './module';
import { register as watchers } from './watchers';

// Feature modules register here, one line each. Keep this list sorted.
export const MODULES: Module[] = [watchers];
