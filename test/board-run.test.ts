import { describe, expect, it } from 'vitest';
import { boardId } from '../src/shared/board';

// A card opened on the board never starts a run: the runner is fed from the code host, and a board id is never a number, so no board card can name
// an issue of the host. Nothing here reaches a network, a model or a repository.

describe('a board card as the start of a run', () => {
  it('carries a reference the runner refuses: a board id is never a number, so it names no issue', () => {
    // The runner resolves a start from the bare digits of the reference (`refOf`, `deps.issues.get`) and refuses anything else as `bad-ref`.
    const badRef = /^\d{1,9}$/;
    for (let i = 0; i < 200; i++) {
      const id = boardId(Uint8Array.from({ length: 16 }, (_, k) => (i * 37 + k * 5) % 256));
      expect(badRef.test(id)).toBe(false);
      // Even with the prefix of the workspace stripped, what is left is the board id: never the digits of an issue.
      const ref = `app#${id}`;
      expect(badRef.test(ref.startsWith('app#') ? ref.slice('app#'.length) : ref)).toBe(false);
    }
  });
});
