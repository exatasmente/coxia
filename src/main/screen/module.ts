import { RunError } from '../../shared/runs';
import type { Module } from '../module';
import { screenHub } from '../runner/module';

// What the person does to an agent's virtual screen from the desktop window: take control of it and send input. These channels are outside the `runs:` family on
// purpose, and webPolicy.ts denies the whole `screen:` prefix to a paired browser with a pattern, so a channel added here is closed to it from the day it exists. The
// phone only watches (`runs:screen`, a read). Neither channel throws for a state (a stage that ended answers `none`): only a call that is not formed is an error.

const runId = (v: unknown): string => {
  if (typeof v !== 'string') throw new RunError('unknown-run', { id: '' });
  return v;
};

export const screenModule: Module = (ctx) => {
  ctx.handle('screen:control', (run: unknown, on: unknown) => {
    const id = runId(run);
    if (typeof on !== 'boolean') throw new RunError('unknown-run', { id });
    return screenHub()?.control(id, on) ?? { ok: false, reason: 'none' as const };
  });
  ctx.handle('screen:input', (run: unknown, events: unknown) => {
    const id = runId(run);
    if (!Array.isArray(events)) throw new RunError('unknown-run', { id });
    return screenHub()?.input(id, events) ?? { ok: false, delivered: 0, rejected: 0, reason: 'none' as const };
  });
};
