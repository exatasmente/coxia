import type { ScreenFrameAnswer } from '../../shared/screen';
import type { HandoffAnswer } from '../../shared/handoff';
import { RunError } from '../../shared/runs';
import type { Module } from '../module';
import { handoffService, screenHub } from '../runner/module';
import type { HandoffService } from './handoff';
import type { ScreenHub } from './hub';

// What the person does to an agent's virtual screen from the desktop window: take control of it and send input, and take it over when the agent hands it over (#178). These
// channels are outside the `runs:` family on purpose, and webPolicy.ts denies the whole `screen:` prefix to a paired browser with a pattern, so a channel added here is closed to
// it from the day it exists. The phone only watches (`runs:screen`, a read, which answers `held` instead of a picture while the person has the screen for a hand-off). Neither
// channel throws for a state (a stage that ended answers `none`): only a call that is not formed is an error.

// The first argument is a screen key (`run:<id>` or `call:<thread>:<agent>`); a bare run id means the stage's.
const runId = (v: unknown): string => {
  if (typeof v !== 'string') throw new RunError('unknown-run', { id: '' });
  return v;
};

const GONE: HandoffAnswer = { ok: false, reason: 'none' };

/** What the hand-off channels need: the service and the hub, read when a call comes since they exist only once the runner's module has registered. */
export interface HandoffChannelDeps {
  service(): HandoffService | null;
  hub(): ScreenHub | null;
}

/**
 * The three channels of a hand-off that only the desktop window has: take the screen (after the warning), give it back, and read the picture of the screen the person holds. The
 * picture is read here, under `screen:`, and not in the `runs:` family where a paired browser reads, because it is the one reader that is let past the withheld interval.
 */
export function handoffChannels(deps: HandoffChannelDeps): {
  'screen:handoffTake': (key: unknown, askId: unknown) => Promise<HandoffAnswer>;
  'screen:handoffGive': (key: unknown) => HandoffAnswer;
  'screen:handoffFrame': (key: unknown, since: unknown, width: unknown) => Promise<ScreenFrameAnswer>;
} {
  return {
    'screen:handoffTake': async (key, askId) => {
      const id = runId(key);
      return (await deps.service()?.take(id, typeof askId === 'string' ? askId : '')) ?? GONE;
    },
    'screen:handoffGive': (key) => deps.service()?.give(runId(key)) ?? GONE,
    'screen:handoffFrame': async (key, since, width) => {
      const id = runId(key);
      return (await deps.hub()?.frame(id, typeof since === 'number' && Number.isFinite(since) ? since : 0, typeof width === 'number' ? width : Number.NaN, 'person')) ?? { state: 'none' };
    },
  };
}

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
  const handoff = handoffChannels({ service: handoffService, hub: screenHub });
  ctx.handle('screen:handoffTake', handoff['screen:handoffTake']);
  ctx.handle('screen:handoffGive', handoff['screen:handoffGive']);
  ctx.handle('screen:handoffFrame', handoff['screen:handoffFrame']);
};
