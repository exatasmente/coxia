import { useMemo, useState } from 'react';
import { squadsOf } from '../../../../shared/config/squads';
import { removeAgent } from '../../../../shared/config/team';
import { LLM_ROLES, type AgentDef, type AgentPermission, type LlmRole, type WorkspaceConfig } from '../../../../shared/config/types';
import { flowIssueText } from '../../../../shared/runs/flowCheck';
import { squadIssueText } from '../../../../shared/runs/squadCheck';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { applyAgent, agentProblems, blankAgent, draftOf, slugOf, stagesLosingAgent, stagesOfAgent, teamIssues, turnsToChoices, uniqueId, type AgentDraft } from './agentEdit';
import { teamApi } from './teamApi';
import { agentName, agentNameById, shown, squadName } from './text';
import { Confirm, Labeled, Problems, SidePanel, Toggle, type Problem, type SectionProps } from './ui';

type Translate = ReturnType<typeof useT>;

/** "Same as <role>" or "<provider> · <model>". */
export function modelText(config: WorkspaceConfig, a: AgentDef, t: Translate): string {
  if (a.model.role) return t('ui.team.model.role', { role: t(`ui.settings.role.${a.model.role}.label`) });
  return `${a.model.provider} · ${a.model.model}`;
}

/** Settings › Team: who is on the team, what each one does, and the switch that lets it run by itself. */
export function TeamSection(props: SectionProps) {
  const { config, save, reload } = props;
  const t = useT();
  const [editing, setEditing] = useState<{ draft: AgentDraft; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const squads = squadsOf(config);

  const toggle = async (a: AgentDef, on: boolean) => {
    setError(null);
    try {
      await teamApi.setAutonomous(a.id, on);
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="tm-split" data-open={editing ? 'true' : 'false'}>
      <div className="wz-stack">
        <div className="row spread">
          <p className="small muted" style={{ flex: '1 1 240px' }}>{t('ui.team.hint')}</p>
          <button type="button" className="btn btn-dark" onClick={() => setEditing({ draft: blankAgent(), isNew: true })}>{t('ui.team.new')}</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <ul className="tm-list" aria-label={t('ui.team.listAria')}>
          {config.agents.team.map((a) => {
            const works = stagesOfAgent(config, a);
            const squad = squads.find((s) => s.id === a.squad);
            const held = a.autonomous && squad && !squad.autonomy;
            return (
              <li key={a.id} className={`tm-card${editing?.draft.id === a.id && !editing.isNew ? ' tm-on' : ''}`}>
                <div className="tm-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="tm-card-title">
                      {agentName(a)} <span className="small muted mono">@{a.id}</span>
                      {a.system && <span className="badge badge-quiet" style={{ marginLeft: 8 }}>{t('ui.team.system')}</span>}
                    </div>
                    <div className="small muted tm-clamp">{shown(a.job) || t('ui.team.noJob')}</div>
                  </div>
                  <button type="button" className="btn" aria-label={t('ui.team.editAria', { name: agentName(a) })} onClick={() => setEditing({ draft: draftOf(a), isNew: false })}>{t('ui.team.edit')}</button>
                </div>
                <dl className="tm-meta">
                  <div><dt>{t('ui.team.squad')}</dt><dd>{squad ? squadName(squad) : t('ui.team.shared')}</dd></div>
                  <div><dt>{t('ui.team.stages')}</dt><dd>{works.length ? works.map((s) => s.label || s.id).join(', ') : t('ui.team.noStages')}</dd></div>
                  <div><dt>{t('ui.team.permission')}</dt><dd>{t(`ui.team.permission.${a.permission}`)}</dd></div>
                  <div><dt>{t('ui.team.model')}</dt><dd>{modelText(config, a, t)}</dd></div>
                  <div><dt>{t('ui.team.turnsTo')}</dt><dd>{a.turnsTo ? agentNameById(config, a.turnsTo) : t('ui.team.thePerson')}</dd></div>
                </dl>
                <Toggle checked={a.autonomous} onChange={(on) => void toggle(a, on)} label={t('ui.team.autonomy')} hint={held ? t('ui.team.heldBySquad') : undefined} />
                {held && <div className="small muted">{t('ui.team.heldBySquad')}</div>}
              </li>
            );
          })}
        </ul>
      </div>
      {editing && (
        <AgentPanel
          key={editing.isNew ? 'new' : editing.draft.id}
          config={config}
          initial={editing.draft}
          isNew={editing.isNew}
          save={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AgentPanel({ config, initial, isNew, save, onClose }: { config: WorkspaceConfig; initial: AgentDraft; isNew: boolean; save: SectionProps['save']; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<AgentDraft>(initial);
  const [idTouched, setIdTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const system = !isNew && config.agents.team.find((a) => a.id === initial.id)?.system === true;
  const set = (patch: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const squads = squadsOf(config);

  const own = useMemo(() => agentProblems(config, draft, isNew), [config, draft, isNew]);
  const team = useMemo(() => teamIssues(config, draft, isNew), [config, draft, isNew]);
  const problems: Problem[] = [
    ...own.map((p) => ({ severity: 'error' as const, text: t(p.key, p.params) })),
    ...team.flow.map((i) => ({ severity: i.severity, text: flowIssueText(i, t) })),
    ...team.squad.map((i) => ({ severity: i.severity, text: squadIssueText(i, t) })),
  ];
  const blocked = problems.some((p) => p.severity === 'error');
  const fieldError = (field: string): string | undefined => {
    const p = own.find((x) => x.field === field);
    return p ? t(p.key, p.params) : undefined;
  };
  const lost = useMemo(() => (isNew || system ? [] : stagesLosingAgent(config, initial.id)), [config, initial.id, isNew, system]);

  const run = async (make: () => WorkspaceConfig) => {
    setSaving(true);
    setError(null);
    try {
      await save(make());
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const remove = () => run(() => removeAgent(config, initial.id));

  return (
    <SidePanel label={isNew ? t('ui.team.panel.new') : t('ui.team.panel.edit', { name: agentName({ id: initial.id, name: initial.name }) })} onClose={onClose}>
      <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); if (!blocked) void run(() => applyAgent(config, draft, isNew)); }}>
        <Labeled label={t('ui.team.f.name')} error={fieldError('name')}>
          {(id) => (
            <input
              id={id}
              className="text-input"
              maxLength={100}
              value={shown(draft.name)}
              onChange={(e) => {
                const name = e.target.value;
                set({ name, ...(isNew && !idTouched ? { id: uniqueId(slugOf(name), config.agents.team.map((a) => a.id)) } : {}) });
              }}
            />
          )}
        </Labeled>
        {isNew ? (
          <Labeled label={t('ui.team.f.id')} hint={t('ui.team.f.idHint')} error={fieldError('id')}>
            {(id) => <input id={id} className="text-input mono" maxLength={48} spellCheck={false} value={draft.id} onChange={(e) => { setIdTouched(true); set({ id: e.target.value.trim() }); }} />}
          </Labeled>
        ) : (
          <p className="small muted">{t('ui.team.f.idFixed', { id: draft.id })}</p>
        )}
        <Labeled label={t('ui.team.f.job')} hint={t('ui.team.f.jobHint')}>
          {(id) => <textarea id={id} className="text-input" rows={2} maxLength={1000} value={shown(draft.job)} onChange={(e) => set({ job: e.target.value })} />}
        </Labeled>
        <Labeled label={t('ui.team.f.instructions')} hint={t('ui.team.f.instructionsHint')}>
          {(id) => <textarea id={id} className="text-input" rows={5} maxLength={4000} value={shown(draft.instructions)} onChange={(e) => set({ instructions: e.target.value })} />}
        </Labeled>

        <ModelFields config={config} draft={draft} set={set} error={fieldError('model')} />

        <Labeled label={t('ui.team.f.permission')} hint={t(`ui.team.permission.${draft.permission}.hint`)}>
          {(id) => (
            <select id={id} className="text-input" value={draft.permission} onChange={(e) => set({ permission: e.target.value as AgentPermission })}>
              <option value="read">{t('ui.team.permission.read')}</option>
              <option value="worktree">{t('ui.team.permission.worktree')}</option>
            </select>
          )}
        </Labeled>
        <Toggle checked={draft.autonomous} onChange={(autonomous) => set({ autonomous })} label={t('ui.team.autonomy')} />
        <p className="small muted">{t('ui.team.autonomyHint')}</p>

        <Labeled label={t('ui.team.f.squad')} hint={t('ui.team.f.squadHint')}>
          {(id) => (
            <select id={id} className="text-input" value={draft.squad ?? ''} onChange={(e) => set({ squad: e.target.value || null })}>
              <option value="">{t('ui.team.shared')}</option>
              {squads.map((s) => <option key={s.id} value={s.id}>{squadName(s)}</option>)}
            </select>
          )}
        </Labeled>
        <Labeled label={t('ui.team.f.turnsTo')} hint={t('ui.team.f.turnsToHint')}>
          {(id) => (
            <select id={id} className="text-input" value={draft.turnsTo ?? ''} onChange={(e) => set({ turnsTo: e.target.value || null })}>
              <option value="">{t('ui.team.thePerson')}</option>
              {turnsToChoices(config, draft.id).map((a) => <option key={a.id} value={a.id}>{agentName(a)}</option>)}
            </select>
          )}
        </Labeled>

        <Problems items={problems} />
        {error && <div className="error" role="alert">{error}</div>}

        {confirmDelete && (
          <Confirm danger confirmLabel={t('ui.team.delete.confirm')} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)}>
            <strong>{t('ui.team.delete.title', { name: agentName({ id: initial.id, name: initial.name }) })}</strong>
            {lost.length > 0 ? (
              <>
                <p>{t('ui.team.delete.lose')}</p>
                <ul className="wz-list">
                  {lost.map((s) => <li key={`${s.squad ?? ''}/${s.stage}`}>{s.squad ? t('ui.team.delete.stageIn', { stage: s.label, squad: s.squad }) : s.label}</li>)}
                </ul>
              </>
            ) : (
              <p>{t('ui.team.delete.noneLost')}</p>
            )}
          </Confirm>
        )}

        <div className="wz-actions">
          <button type="submit" className="btn btn-dark" disabled={saving || blocked}>{saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('ui.team.cancel')}</button>
          {!isNew && !system && !confirmDelete && <button type="button" className="btn tm-danger" onClick={() => setConfirmDelete(true)}>{t('ui.team.delete')}</button>}
        </div>
        {system && <p className="small muted">{t('ui.team.systemNote')}</p>}
      </form>
    </SidePanel>
  );
}

function ModelFields({ config, draft, set, error }: { config: WorkspaceConfig; draft: AgentDraft; set: (p: Partial<AgentDraft>) => void; error?: string }) {
  const t = useT();
  const byRole = draft.model.role !== null;
  const provider = config.llm.providers.find((p) => p.id === draft.model.provider);
  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.team.f.model')}</legend>
      <div role="group" aria-label={t('ui.team.f.model')} className="wz-pills">
        <button type="button" aria-pressed={byRole} className={`filter ${byRole ? 'on' : ''}`} onClick={() => set({ model: { role: draft.model.role ?? 'deep', provider: '', model: '' } })}>{t('ui.team.model.useRole')}</button>
        <button type="button" aria-pressed={!byRole} className={`filter ${!byRole ? 'on' : ''}`} onClick={() => set({ model: { role: null, provider: draft.model.provider || (config.llm.providers[0]?.id ?? ''), model: draft.model.model } })}>{t('ui.team.model.useProvider')}</button>
      </div>
      {byRole ? (
        <Labeled label={t('ui.team.model.role.label')} hint={t('ui.team.model.role.hint')}>
          {(id) => (
            <select id={id} className="text-input" value={draft.model.role ?? 'deep'} onChange={(e) => set({ model: { role: e.target.value as LlmRole, provider: '', model: '' } })}>
              {LLM_ROLES.map((r) => <option key={r} value={r}>{t(`ui.settings.role.${r}.label`)}</option>)}
            </select>
          )}
        </Labeled>
      ) : (
        <div className="wz-two">
          <Labeled label={t('ui.team.model.provider')}>
            {(id) => (
              <select id={id} className="text-input" value={draft.model.provider} onChange={(e) => set({ model: { role: null, provider: e.target.value, model: draft.model.model } })}>
                {config.llm.providers.length === 0 && <option value="">{t('ui.team.model.noProvider')}</option>}
                {config.llm.providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
              </select>
            )}
          </Labeled>
          <Labeled label={t('ui.team.model.name')}>
            {(id) => (
              <>
                <input id={id} className="text-input mono" list={`${id}-models`} spellCheck={false} value={draft.model.model} onChange={(e) => set({ model: { role: null, provider: draft.model.provider, model: e.target.value } })} />
                <datalist id={`${id}-models`}>{(provider?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              </>
            )}
          </Labeled>
        </div>
      )}
      {error && <div className="tm-field-error small" role="alert">{error}</div>}
    </fieldset>
  );
}
