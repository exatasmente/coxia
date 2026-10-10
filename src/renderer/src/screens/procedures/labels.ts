import type { ProcedureKind, ProcedureState, ProcedureSurface } from '../../../../shared/procedures';

// The catalog keys of the words the Procedures view uses for the record's own vocabulary.

export const KIND_LABEL: Record<ProcedureKind, string> = {
  gui: 'ui.procedures.kind.gui',
  repo: 'ui.procedures.kind.repo',
  tool: 'ui.procedures.kind.tool',
  cycle: 'ui.procedures.kind.cycle',
  request: 'ui.procedures.kind.request',
};

export const STATE_LABEL: Record<ProcedureState, string> = {
  unverified: 'ui.procedures.state.unverified',
  ok: 'ui.procedures.state.ok',
  failing: 'ui.procedures.state.failing',
};

export const SURFACE_LABEL: Record<ProcedureSurface, string> = {
  stage: 'ui.procedures.surface.stage',
  direct: 'ui.procedures.surface.direct',
  channel: 'ui.procedures.surface.channel',
  forum: 'ui.procedures.surface.forum',
  'run-thread': 'ui.procedures.surface.runThread',
  called: 'ui.procedures.surface.called',
  person: 'ui.procedures.surface.person',
};

export const STEPS_FROM_LABEL = {
  recording: 'ui.procedures.panel.stepsRecording',
  edited: 'ui.procedures.panel.stepsEdited',
  agent: 'ui.procedures.panel.stepsAgent',
} as const;

/** Tone of the state badge, with the classes the run screens already use. */
export const STATE_TONE: Record<ProcedureState, string> = { unverified: 'cy-tone-quiet', ok: 'cy-tone-done', failing: 'cy-tone-blocked' };
