// The real electron package resolves the path of its binary when it is loaded, and downloads the binary when it is missing: no test may reach it.
import { describe, expect, it } from 'vitest';

describe('electron in the tests', () => {
  it('is the stub, never the package that would download its binary', async () => {
    const electron: Record<string, unknown> = await import('electron');
    // the real package exports the binary's path as its default
    expect(electron.default).toBeUndefined();
    expect(electron.app).toBeUndefined();
  });
});
