import { ASSIST_LIMITS, type AssistField, type AssistSettings } from '../../../../shared/agentAssist';
import { squadsOf } from '../../../../shared/config/squads';
import type { AgentPermission, AgentShell, AgentToolsConfig, AgentTracker, StageDef, WorkspaceConfig } from '../../../../shared/config/types';
import { useT } from '../../i18n';
import { diffAgent, resetField, reviewRows, type AssistState, type SettingChange } from './assistEdit';
import { ASSIST_FIELD_LABEL, PERMISSION_LABEL, SHELL_LABEL, TOOL_LABEL, TRACKER_LABEL } from './labels';
import { agentNameById, shown, squadName } from './text';
import { Labeled } from './ui';

type Translate = ReturnType<typeof useT>;

const TOOL_KEYS = ['files', 'skills', 'vcsCli', 'subagents'] as const;

/** A setting in words, as the editor names its values. */
export function settingText(config: WorkspaceConfig, field: AssistField, value: AssistSettings[AssistField], t: Translate): string {
  switch (field) {
    case 'permission':
      return t(PERMISSION_LABEL[value as AgentPermission]);
    case 'tracker':
      return t(TRACKER_LABEL[value as AgentTracker]);
    case 'shell':
      return t(SHELL_LABEL[value as AgentShell]);
    case 'tools': {
      const tools = value as AgentToolsConfig | null;
      if (!tools) return t('ui.team.tools.inherit');
      const on = TOOL_KEYS.filter((k) => tools[k]).map((k) => t(TOOL_LABEL[k]));
      return on.length ? on.join(', ') : t('ui.team.assist.toolsNone');
    }
    case 'stages': {
      const ids = value as string[];
      const all: StageDef[] = [...config.devCycle.stages, ...Object.values(config.devCycle.flows ?? {}).flat()];
      return ids.length ? ids.map((id) => shown(all.find((s) => s.id === id)?.label ?? '') || id).join(', ') : t('ui.team.noStages');
    }
    case 'squad': {
      const id = value as string | null;
      return id ? squadName(squadsOf(config).find((s) => s.id === id) ?? { id, name: id }) : t('ui.team.shared');
    }
    case 'turnsTo': {
      const id = value as string | null;
      return id ? agentNameById(config, id) : t('ui.team.thePerson');
    }
  }
}

function Row({ config, row, adjusting, disabled, onReset }: { config: WorkspaceConfig; row: SettingChange; adjusting: boolean; disabled?: boolean; onReset: () => void }) {
  const t = useT();
  const value = settingText(config, row.field, row.value, t);
  return (
    <li className="tm-assist-row">
      <div className="tm-assist-row-head">
        <strong>{t(ASSIST_FIELD_LABEL[row.field])}</strong>
        <span className="tm-assist-value">{adjusting ? t('ui.team.assist.change', { before: settingText(config, row.field, row.before, t), after: value }) : value}</span>
      </div>
      {row.reason && <p className="small muted tm-assist-reason">{t('ui.team.assist.reason', { reason: row.reason })}</p>}
      {row.field === 'permission' && row.value === 'worktree' && <p className="small tm-assist-warn" role="note">{t('ui.team.assist.worktreeNote')}</p>}
      <button type="button" className="btn tm-mini" disabled={disabled} onClick={onReset}>{adjusting ? t('ui.team.assist.reset.original') : t('ui.team.assist.reset.minimum')}</button>
    </li>
  );
}

/**
 * The review: the three texts to edit, then every setting that passes the minimum with the reason the model gave and a button that puts it back. Adjusting an agent,
 * it says what changed, before and after, and "back" returns the value the agent had. The state is the assistant's; this only reads it and says what to do to it.
 */
export function AssistReview({ config, state, disabled, onChange }: { config: WorkspaceConfig; state: AssistState; disabled?: boolean; onChange: (next: AssistState) => void }) {
  const t = useT();
  const adjusting = state.mode === 'adjust';
  const rows = reviewRows(state);
  const changes = diffAgent(state).texts;
  const set = (patch: Partial<AssistState['draft']>) => onChange({ ...state, draft: { ...state.draft, ...patch } });
  const before = (field: 'name' | 'job' | 'instructions') => changes.find((c) => c.field === field)?.before;

  const was = (field: 'name' | 'job' | 'instructions') => {
    const text = before(field);
    return text === undefined ? null : (
      <details className="small muted tm-assist-was">
        <summary>{t('ui.team.assist.before')}</summary>
        <p className="tm-assist-was-text">{text || t('ui.team.assist.empty')}</p>
      </details>
    );
  };

  return (
    <div className="wz-stack">
      <p className="small muted">{t('ui.team.assist.review.hint')}</p>
      {!state.draft.name.trim() && <p className="small tm-assist-warn" role="status">{t('ui.team.assist.noName')}</p>}
      <Labeled label={t('ui.team.f.name')} hint={was('name')}>
        {(id) => <input id={id} className="text-input" maxLength={ASSIST_LIMITS.name} disabled={disabled} value={state.draft.name} onChange={(e) => set({ name: e.target.value })} />}
      </Labeled>
      <Labeled label={t('ui.team.f.job')} hint={was('job')}>
        {(id) => <textarea id={id} className="text-input" rows={2} maxLength={ASSIST_LIMITS.job} disabled={disabled} value={state.draft.job} onChange={(e) => set({ job: e.target.value })} />}
      </Labeled>
      <Labeled label={t('ui.team.f.instructions')} hint={was('instructions')}>
        {(id) => <textarea id={id} className="text-input" rows={7} maxLength={ASSIST_LIMITS.instructions} disabled={disabled} value={state.draft.instructions} onChange={(e) => set({ instructions: e.target.value })} />}
      </Labeled>
      <section className="tm-assist-settings" aria-label={t(adjusting ? 'ui.team.assist.review.changes' : 'ui.team.assist.review.settings')}>
        <h4 className="wz-label">{t(adjusting ? 'ui.team.assist.review.changes' : 'ui.team.assist.review.settings')}</h4>
        {rows.length === 0 ? (
          <p className="small muted">{t(adjusting ? 'ui.team.assist.review.noneAdjust' : 'ui.team.assist.review.none')}</p>
        ) : (
          <ul className="tm-assist-rows">
            {rows.map((row) => <Row key={row.field} config={config} row={row} adjusting={adjusting} disabled={disabled} onReset={() => onChange(resetField(state, row.field))} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
