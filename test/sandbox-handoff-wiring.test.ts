// The sandbox service hands the hand-off's gate and mask to the session it makes (#178): a call asked to open a host session with `held` and `mask` gets a session that
// refuses while the person has the screen, without running or logging anything, and masks what it prints. The sandbox path takes the same two options to `openSession`
// (types only; it needs bwrap to run). Real processes, a throwaway folder, no display.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { createSandboxService } from '../src/main/sandbox';
import { createTypedValues } from '../src/main/screen/typedValues';

const posix = process.platform !== 'win32';

describe.runIf(posix)('a host session made by the sandbox service for a call with a hand-off', () => {
  it('refuses while the person has the screen, runs again after, and masks what the person typed', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'coxia-handoff-wiring-'));
    const service = createSandboxService({ dir: join(wt, 'sandbox'), hostEnv: async () => ({ ...process.env }) });
    const typed = createTypedValues();
    let held = false;
    const seen: string[] = [];
    const session = await service.openHost({ worktree: wt, reader: false, config: neutralSandbox(), onExec: (r) => seen.push(r.command), held: () => held, mask: typed.mask });
    held = true;
    const refused = await session.exec('touch made-while-held');
    expect(refused.refused).toBe('handoff');
    expect(existsSync(join(wt, 'made-while-held'))).toBe(false);
    // Unlogged: nothing numbered, nothing told to the thread.
    expect(session.log).toEqual([]);
    expect(seen).toEqual([]);
    held = false;
    typed.add(['correct-horse-battery']);
    const after = await session.exec('echo correct-horse-battery');
    await session.close();
    expect(after.exitCode).toBe(0);
    expect(after.output).toBe('[secret]');
  });

  it('is what it was for a call with no hand-off', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'coxia-handoff-wiring-'));
    const service = createSandboxService({ dir: join(wt, 'sandbox'), hostEnv: async () => ({ ...process.env }) });
    const session = await service.openHost({ worktree: wt, reader: false, config: neutralSandbox() });
    const r = await session.exec('echo plain');
    await session.close();
    expect(r.output).toBe('plain');
  });
});
