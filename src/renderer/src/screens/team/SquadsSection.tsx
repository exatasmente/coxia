import { useMemo, useState } from 'react';
import { membersOf, squadsOf } from '../../../../shared/config/squads';
import type { SquadDef, WorkspaceConfig } from '../../../../shared/config/types';
import { squadIssueText } from '../../../../shared/runs/squadCheck';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { slugOf, uniqueId } from './agentEdit';
import { applySquad, blankSquad, draftOfSquad, hasOwnFlow, memberChoices, movingAgents, normalizePrefix, squadIssues, squadProblems, withLabel, type SquadDraft } from './squadEdit';
import { teamApi } from './teamApi';
import { agentName, agentNameById, shown, squadName } from './text';
import { ChipsInput, Confirm, Labeled, Problems, SidePanel, Toggle, type Problem, type SectionProps } from './ui';

type Translate = ReturnType<typeof useT>;

function scopeLines(s: SquadDef, t: Translate): string[] {
  const out: string[] = [];
  if (s.scope.repos.length) out.push(t('ui.squads.scope.repos', { list: s.scope.repos.join(', ') }));
  if (s.scope.labels.length) out.push(t('ui.squads.scope.labels', { list: s.scope.labels.join(', ') }));
  if (s.scope.paths.length) out.push(t('ui.squads.scope.paths', { list: s.scope.paths.map((p) => `${p.repo}:${p.prefix}`).join(', ') }));
  if (s.scope.unclaimed) out.push(t('ui.squads.scope.unclaimed'));
  return out.length ? out : [t('ui.squads.scope.none')];
}

/** Settings › Squads: who is in each squad, what work is theirs, who speaks for them, and which flow they follow. */
export function SquadsSection(props: SectionProps & { openFlow: (squad?: string) => void }) {
  const { config, save, reload, openFlow } = props;
  const t = useT();
  const [editing, setEditing] = useState<{ draft: SquadDraft; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const squads = squadsOf(config);

  const toggle = async (s: SquadDef, on: boolean) => {
    setError(null);
    try {
      await teamApi.setSquadAutonomous(s.id, on);
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="tm-split" data-open={editing ? 'true' : 'false'}>
      <div className="wz-stack">
        <div className="row spread">
          <p className="small muted" style={{ flex: '1 1 240px' }}>{t('ui.squads.hint')}</p>
          <button type="button" className="btn btn-dark" onClick={() => setEditing({ draft: blankSquad(), isNew: true })}>{t('ui.squads.new')}</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {squads.length === 0 && <p className="panel small muted">{t('ui.squads.none')}</p>}
        <ul className="tm-list" aria-label={t('ui.squads.listAria')}>
          {squads.map((s) => {
            const members = membersOf(config, s.id);
            return (
              <li key={s.id} className={`tm-card${editing?.draft.id === s.id && !editing.isNew ? ' tm-on' : ''}`}>
                <div className="tm-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="tm-card-title">{squadName(s)} <span className="small muted mono">{s.id}</span></div>
                    <div className="small muted tm-clamp">{shown(s.mission) || t('ui.squads.noMission')}</div>
                  </div>
                  <button type="button" className="btn" aria-label={t('ui.squads.editAria', { name: squadName(s) })} onClick={() => setEditing({ draft: draftOfSquad(config, s), isNew: false })}>{t('ui.team.edit')}</button>
                </div>
                <dl className="tm-meta">
                  <div><dt>{t('ui.squads.scope')}</dt><dd>{scopeLines(s, t).join(' · ')}</dd></div>
                  <div><dt>{t('ui.squads.members')}</dt><dd>{members.length ? members.map(agentName).join(', ') : t('ui.squads.noMembers')}</dd></div>
                  <div><dt>{t('ui.squads.liaison')}</dt><dd>{s.liaison ? agentNameById(config, s.liaison) : t('ui.squads.noLiaison')}</dd></div>
                  <div><dt>{t('ui.squads.flow')}</dt><dd>{hasOwnFlow(config, s.id) ? t('ui.squads.flow.own') : t('ui.squads.flow.workspace')}</dd></div>
                  {s.label && <div><dt>{t('ui.squads.label')}</dt><dd className="mono">{s.label}</dd></div>}
                </dl>
                <div className="row spread">
                  <Toggle checked={s.autonomy} onChange={(on) => void toggle(s, on)} label={t('ui.squads.autonomy')} />
                  <button type="button" className="btn" onClick={() => openFlow(s.id)}>{t('ui.squads.editFlow')}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {editing && (
        <SquadPanel
          key={editing.isNew ? 'new' : editing.draft.id}
          config={config}
          initial={editing.draft}
          isNew={editing.isNew}
          save={save}
          reload={reload}
          openFlow={openFlow}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface RemovalPlan {
  runs: { id: string; text: string }[];
}

function SquadPanel({ config, initial, isNew, save, reload, openFlow, onClose }: { config: WorkspaceConfig; initial: SquadDraft; isNew: boolean; save: SectionProps['save']; reload: () => void; openFlow: (squad?: string) => void; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<SquadDraft>(initial);
  const [idTouched, setIdTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalPlan | null>(null);
  const set = (patch: Partial<SquadDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const own = useMemo(() => squadProblems(config, draft, isNew), [config, draft, isNew]);
  const checks = useMemo(() => squadIssues(config, draft, isNew), [config, draft, isNew]);
  const moving = useMemo(() => movingAgents(config, draft), [config, draft]);
  const problems: Problem[] = [
    ...own.map((p) => ({ severity: 'error' as const, text: t(p.key, p.params) })),
    ...checks.map((i) => ({ severity: i.severity, text: squadIssueText(i, t) })),
  ];
  const blocked = problems.some((p) => p.severity === 'error');
  const fieldError = (field: string): string | undefined => {
    const p = own.find((x) => x.field === field);
    return p ? t(p.key, p.params) : undefined;
  };
  const members = draft.members.map((id) => config.agents.team.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await save(applySquad(config, draft, isNew));
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  // The runs the squad has are listed before anything is removed; the removal itself happens only after the confirmation.
  const askRemove = async () => {
    setError(null);
    try {
      const { runs: ids } = await teamApi.removeSquad(initial.id, false);
      const known = await teamApi.runs().catch(() => []);
      setRemoval({ runs: ids.map((id) => { const r = known.find((x) => x.id === id); return { id, text: r ? `${r.issue.ref} · ${r.issue.title}` : id }; }) });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const remove = async () => {
    setSaving(true);
    try {
      await teamApi.removeSquad(initial.id, true);
      reload();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const toggleIn = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const repos = config.projects.repos;

  return (
    <SidePanel label={isNew ? t('ui.squads.panel.new') : t('ui.squads.panel.edit', { name: shown(initial.name) || initial.id })} onClose={onClose}>
      <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); if (!blocked) void submit(); }}>
        <Labeled label={t('ui.squads.f.name')} error={fieldError('name')}>
          {(id) => (
            <input
              id={id}
              className="text-input"
              maxLength={100}
              value={shown(draft.name)}
              onChange={(e) => {
                const name = e.target.value;
                set({ name, ...(isNew && !idTouched ? { id: uniqueId(slugOf(name), squadsOf(config).map((s) => s.id)) } : {}) });
              }}
            />
          )}
        </Labeled>
        {isNew ? (
          <Labeled label={t('ui.squads.f.id')} hint={t('ui.squads.f.idHint')} error={fieldError('id')}>
            {(id) => <input id={id} className="text-input mono" maxLength={48} spellCheck={false} value={draft.id} onChange={(e) => { setIdTouched(true); set({ id: e.target.value.trim() }); }} />}
          </Labeled>
        ) : (
          <p className="small muted">{t('ui.squads.f.idFixed', { id: draft.id })}</p>
        )}
        <Labeled label={t('ui.squads.f.mission')} hint={t('ui.squads.f.missionHint')}>
          {(id) => <textarea id={id} className="text-input" rows={2} maxLength={1000} value={shown(draft.mission)} onChange={(e) => set({ mission: e.target.value })} />}
        </Labeled>

        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('ui.squads.f.scope')}</legend>
          <p className="small muted">{t('ui.squads.f.scopeHint')}</p>
          <div className="wz-label">{t('ui.squads.f.repos')}</div>
          {repos.length === 0 ? (
            <p className="small muted">{t('ui.squads.f.noRepos')}</p>
          ) : (
            <div className="tm-checks">
              {repos.map((r) => (
                <label key={r.id} className="tm-check">
                  <input type="checkbox" checked={draft.repos.includes(r.id)} onChange={() => set({ repos: toggleIn(draft.repos, r.id) })} />
                  <span className="mono">{r.id}</span>
                </label>
              ))}
            </div>
          )}
          <ChipsInput label={t('ui.squads.f.labels')} hint={t('ui.squads.f.labelsHint')} addLabel={t('ui.squads.f.labelAdd')} removeLabel={(label) => t('ui.squads.f.labelRemove', { label })} values={draft.labels} onChange={(labels) => set({ labels })} add={withLabel} />
          <PathRows config={config} paths={draft.paths} onChange={(paths) => set({ paths })} error={fieldError('paths')} />
          <label className="tm-check">
            <input type="checkbox" checked={draft.unclaimed} onChange={(e) => set({ unclaimed: e.target.checked })} />
            <span>{t('ui.squads.f.unclaimed')}</span>
          </label>
          <p className="small muted">{t('ui.squads.f.unclaimedHint')}</p>
        </fieldset>

        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('ui.squads.f.members')}</legend>
          <p className="small muted">{t('ui.squads.f.membersHint')}</p>
          <div className="tm-checks">
            {memberChoices(config).map((a) => (
              <label key={a.id} className="tm-check">
                <input type="checkbox" checked={draft.members.includes(a.id)} onChange={() => set({ members: toggleIn(draft.members, a.id), ...(draft.liaison === a.id && draft.members.includes(a.id) ? { liaison: null } : {}) })} />
                <span>{agentName(a)}{a.squad && a.squad !== draft.id ? <span className="small muted"> · {t('ui.squads.f.inSquad', { squad: squadName(squadsOf(config).find((s) => s.id === a.squad) ?? { id: a.squad, name: a.squad }) })}</span> : null}</span>
              </label>
            ))}
          </div>
          {moving.length > 0 && <p className="small muted">{t('ui.squads.f.moving', { agents: moving.map((m) => agentNameById(config, m.agent)).join(', ') })}</p>}
        </fieldset>

        <Labeled label={t('ui.squads.f.liaison')} hint={t('ui.squads.f.liaisonHint')} error={fieldError('liaison')}>
          {(id) => (
            <select id={id} className="text-input" value={draft.liaison ?? ''} onChange={(e) => set({ liaison: e.target.value || null })}>
              <option value="">{t('ui.squads.noLiaison')}</option>
              {members.map((a) => <option key={a.id} value={a.id}>{agentName(a)}</option>)}
            </select>
          )}
        </Labeled>
        <Toggle checked={draft.autonomy} onChange={(autonomy) => set({ autonomy })} label={t('ui.squads.autonomy')} />
        <p className="small muted">{t('ui.squads.autonomyHint')}</p>
        <Labeled label={t('ui.squads.f.label')} hint={t('ui.squads.f.labelHint')} error={fieldError('label')}>
          {(id) => <input id={id} className="text-input mono" maxLength={200} spellCheck={false} value={draft.label} onChange={(e) => set({ label: e.target.value })} />}
        </Labeled>
        {!isNew && (
          <div className="wz-stack">
            <div className="wz-label">{t('ui.squads.flow')}</div>
            <p className="small muted">{hasOwnFlow(config, initial.id) ? t('ui.squads.flow.ownHint') : t('ui.squads.flow.workspaceHint')}</p>
            <div className="wz-actions"><button type="button" className="btn" onClick={() => openFlow(initial.id)}>{t('ui.squads.editFlow')}</button></div>
          </div>
        )}

        <Problems items={problems} />
        {error && <div className="error" role="alert">{error}</div>}

        {removal && (
          <Confirm danger confirmLabel={t('ui.squads.delete.confirm')} onConfirm={() => void remove()} onCancel={() => setRemoval(null)}>
            <strong>{t('ui.squads.delete.title', { name: shown(initial.name) || initial.id })}</strong>
            <p>{t('ui.squads.delete.effect')}</p>
            {removal.runs.length > 0 ? (
              <>
                <p>{t('ui.squads.delete.runs', { count: removal.runs.length })}</p>
                <ul className="wz-list">{removal.runs.map((r) => <li key={r.id}>{r.text}</li>)}</ul>
              </>
            ) : (
              <p>{t('ui.squads.delete.noRuns')}</p>
            )}
          </Confirm>
        )}

        <div className="wz-actions">
          <button type="submit" className="btn btn-dark" disabled={saving || blocked}>{saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('ui.team.cancel')}</button>
          {!isNew && !removal && <button type="button" className="btn tm-danger" onClick={() => void askRemove()}>{t('ui.team.delete')}</button>}
        </div>
      </form>
    </SidePanel>
  );
}

function PathRows({ config, paths, onChange, error }: { config: WorkspaceConfig; paths: SquadDraft['paths']; onChange: (next: SquadDraft['paths']) => void; error?: string }) {
  const t = useT();
  const repos = config.projects.repos;
  const edit = (i: number, patch: Partial<SquadDraft['paths'][number]>) => onChange(paths.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="wz-stack">
      <div className="wz-label">{t('ui.squads.f.paths')}</div>
      <p className="small muted">{t('ui.squads.f.pathsHint')}</p>
      {paths.map((p, i) => (
        <div key={i} className="tm-path">
          <select className="text-input" aria-label={t('ui.squads.f.pathRepo', { n: i + 1 })} value={p.repo} onChange={(e) => edit(i, { repo: e.target.value })}>
            <option value="">{t('ui.squads.f.pathPick')}</option>
            {repos.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            {p.repo && !repos.some((r) => r.id === p.repo) && <option value={p.repo}>{p.repo}</option>}
          </select>
          <input className="text-input mono" aria-label={t('ui.squads.f.pathPrefix', { n: i + 1 })} spellCheck={false} placeholder={t('ui.squads.f.pathPlaceholder')} value={p.prefix} onChange={(e) => edit(i, { prefix: e.target.value })} onBlur={() => edit(i, { prefix: normalizePrefix(p.prefix) })} />
          <button type="button" className="btn" aria-label={t('ui.squads.f.pathRemove', { n: i + 1 })} onClick={() => onChange(paths.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="wz-actions"><button type="button" className="btn" onClick={() => onChange([...paths, { repo: repos[0]?.id ?? '', prefix: '' }])}>{t('ui.squads.f.pathAdd')}</button></div>
      {error && <div className="tm-field-error small" role="alert">{error}</div>}
    </div>
  );
}
