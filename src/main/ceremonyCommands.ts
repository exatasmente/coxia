import { CEREMONY_COMMANDS_EVENT, type CeremonyCommand, type CeremonyDecision } from '../shared/ceremonyCommands';
import { t } from '../shared/i18n';
import type { AppEvent } from '../shared/types';
import { recordWrite } from './auditoria';
import { createCommandStore } from './ceremonyCommands-core';
import type { Module } from './module';
import type { Notice } from './scheduler';
import { externalRefusal } from './workspace';
import { updateConfig } from './workspaceConfig';

// The commands the ceremony agents wait to run: the store the agents' shell hook asks, the channels the screens answer through, and where an answer goes
// (the agent's list of rules in the configuration, the audit log). A paired browser may answer too, "always" included: it is the person's choice for
// their own agents, and a write to the code host is still allowed only once.

let emit: ((ev: AppEvent) => void) | null = null;
let notify: ((n: Notice) => void) | null = null;

const event = (list: CeremonyCommand[]): AppEvent => ({ type: 'module', name: CEREMONY_COMMANDS_EVENT, payload: list });

export const ceremonyCommands = createCommandStore({
  changed: (list) => emit?.(event(list)),
  asked: (c) => notify?.({ title: t('main.ceremonyCommand.notice.title', { agent: c.name ?? c.agent }), body: c.command.slice(0, 200), onClick: event(ceremonyCommands.list()) }),
  remember: (agent, rule) => {
    updateConfig((config) => {
      const def = config.agents.team.find((a) => a.id === agent);
      if (def) def.allowedCommands = [...new Set([...(def.allowedCommands ?? []), rule])];
      return config;
    });
  },
  audit: (c: CeremonyCommand, decision: CeremonyDecision) =>
    recordWrite({
      kind: 'exec',
      issue: 0,
      target: c.command.slice(0, 300),
      via: 'ceremony',
      fields: { agent: c.agent, decision, ...(c.rule && decision === 'always' ? { rule: c.rule } : {}), write: String(c.write) },
      ok: true,
      code: null,
      result: '',
      origin: { actionId: '', kind: 'ceremony-command', key: c.id, summary: null },
      by: c.agent,
    }),
  writeRefusal: () => externalRefusal(t('main.ceremonyCommand.write')),
});

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export const register: Module = (ctx) => {
  emit = ctx.emit;
  notify = ctx.notify;
  ctx.handle('ceremony:commands', () => ceremonyCommands.list());
  ctx.handle('ceremony:command', (id: unknown, decision: unknown, note?: unknown) => ceremonyCommands.answer(text(id), decision as CeremonyDecision, text(note)));
};
