export * from './comment';
export * from './flow';
export * from './flowCheck';
export * from './links';
export * from './squadCheck';
export * from './routing';
export * from './schema';
export * from './transitions';
export * from './usage';
export * from './types';

/** A run id from a time and four random lowercase letters or digits: `r-<base36 ms>-<rand>`. */
export function newRunId(nowMs: number, rand: string): string {
  return `r-${nowMs.toString(36)}-${rand}`;
}
export * from './output';
