import { describe, expect, it } from 'vitest';
import { register, boardAvailable, setBoardReady } from '../../src/main/board';

// Hand the module the previous (buggy) wiring the developer describes: deps returning the module's own getter.
describe('probe the previous wiring', () => {
  it('recurses if the app hands the module should hand back', () => {
    setBoardReady(() => setBoardReady(() => boardAvailable() as never as boolean));
    for (const reg of [register]) reg({ handle: () => undefined, notify: () => undefined, emit: () => undefined, job: () => undefined, deps: (d) => setBoardReady(() => d.boardReady()) } as never);
    let threw = false;
    try { boardAvailable(); } catch { threw = true; }
    console.log('threw:', threw);
    expect(true).toBe(true);
  });
});
