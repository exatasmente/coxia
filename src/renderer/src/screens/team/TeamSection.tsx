import { useEffect, useMemo, useRef, useState } from 'react';
import { offeredStages } from '../../../../shared/agentAssist';
import { squadsOf } from '../../../../shared/config/squads';
import { isDraft, removeAgent, shellRaised, trackerRaised } from '../../../../shared/config/team';
import { AGENT_SHELLS, AGENT_TRACKERS, LLM_ROLES, type AgentDef, type AgentPermission, type AgentShell, type AgentToolsConfig, type AgentTracker, type LlmRole, type WorkspaceConfig } from '../../../../shared/config/types';
import { flowIssueText } from '../../../../shared/runs/flowCheck';
import { squadIssueText } from '../../../../shared/runs/squadCheck';
import { errorText, api } from '../../api';
import { forgetNow, reloadThreads } from '../cycle/forumApi';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { AgentAssist } from './AgentAssist';
import { applyAgent, agentProblems, blankAgent, draftOf, promoteDraft, shellAfterPermission, slugOf, stagesLosingAgent, stagesOfAgent, teamIssues, turnsToChoices, uniqueId, type AgentDraft } from './agentEdit';
import { editorOf, startAssist, type AssistState } from './assistEdit';
import { PERMISSION_HINT, SANDBOX_NETWORK_LABEL, SANDBOX_REASON_LABEL, SHELL_HINT, SHELL_LABEL, TRACKER_HINT, TRACKER_LABEL } from './labels';
import { Recommended } from './Recommended';
import { useSandboxStatus } from './sandboxStatus';
import { assistApi, teamApi } from './teamApi';
import { agentName, agentNameById, shown, squadName } from './text';
import { Confirm, Labeled, Problems, SidePanel, Toggle, type Problem, type SectionProps } from './ui';

type Translate = ReturnType<typeof useT>;

/** "Same as <role>" or "<provider> · <model>". */
export function modelText(config: WorkspaceConfig, a: AgentDef, t: Translate): string {
  if (a.model.role) return t('ui.team.model.role', { role: t(`ui.settings.role.${a.model.role}.label`) });
  return `${a.model.provider} · ${a.model.model}`;
}

/** Settings › Team: who is on the team, what each one does, and the switch that lets it run by itself. */
export function TeamSection(props: SectionProps & { suggestion?: { draft: AgentDraft; suggestionId: string } }) {
  const { config, save, reload, suggestion } = props;
  const t = useT();
  const [editing, setEditing] = useState<{ draft: AgentDraft; isNew: boolean; suggestionId?: string; assisted?: boolean; promote?: { id: string } } | null>(null);
  // The assistant's state lives here, above the two panels: the editor it opens can be cancelled and the assistant is still where it was.
  const [assist, setAssist] = useState<AssistState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // The draft agent whose discarding waits for the person's yes: it deletes the agent and its conversation.
  const [discarding, setDiscarding] = useState<string | null>(null);
  const squads = squadsOf(config);

  // A suggestion the card sent here to edit: the editor opens filled in with it and remembers where it came from. The request is kept in a ref (not only
  // in the prop) so the same draft does not reopen the panel every time the section re-renders for another reason.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!suggestion || handled.current === suggestion.suggestionId) return;
    handled.current = suggestion.suggestionId;
    setEditing({ draft: suggestion.draft, isNew: true, suggestionId: suggestion.suggestionId });
  }, [suggestion]);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    setSaid(null);
    try {
      const r = await api.invoke<{ actions: unknown[]; reason?: string }>('suggestions:suggest');
      setSaid(r.reason ?? t('ui.team.suggest.done', { count: r.actions.length }));
      reload();
    } catch (e) {
      setError(errorText(e));
    }
    setSuggesting(false);
  };

  const openAssist = (base: AgentDraft | null) => {
    setError(null);
    setSaid(null);
    setEditing(null);
    setAssist(startAssist(base));
  };

  const closeAssist = (problem?: string) => {
    const was = assist;
    setAssist(null);
    if (problem) setError(problem);
    // Adjusting from the editor: closing the assistant gives the person back the form they had.
    if (was?.mode === 'adjust' && was.base) setEditing({ draft: was.base, isNew: false });
  };

  // Concluding: the editor opens on what the assistant made. A draft agent saved for the test is promoted in place (its id stays); with none, a new agent is made;
  // an agent being adjusted is edited where it is, with the changes not yet saved. Cancelling the editor comes back to the assistant, at the review.
  const openEditor = (s: AssistState) => {
    setAssist({ ...s, step: 'review' });
    setEditing(editorOf(s, config.agents.team.map((a) => a.id)));
  };

  // The agent was saved from the assistant's editor: the assistant is done, and the copy that tested an adjustment goes (when it cannot, it stays in the list as a draft).
  const assistSaved = async () => {
    const was = assist;
    if (was?.mode === 'adjust' && was.testId) {
      try {
        await assistApi.discard(was.testId);
        forgetNow();
        reloadThreads();
      } catch (e) {
        setError(errorText(e));
      }
    }
    setAssist(null);
    reload();
  };

  const discard = async (a: AgentDef) => {
    setDiscarding(null);
    setError(null);
    try {
      await assistApi.discard(a.id);
      forgetNow();
      reloadThreads();
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

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
    <div className="tm-split" data-open={editing || assist ? 'true' : 'false'}>
      <div className="wz-stack">
        <div className="row spread">
          <p className="small muted" style={{ flex: '1 1 240px' }}>{t('ui.team.hint')}</p>
          <div className="row">
            <button type="button" className="btn" disabled={suggesting || isWeb()} onClick={() => void suggest()}>{suggesting ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.suggest.button')}</button>
            {!isWeb() && <button type="button" className="btn" disabled={!!assist} onClick={() => openAssist(null)}>{t('ui.team.assist.create')}</button>}
            <button type="button" className="btn btn-dark" disabled={!!assist} onClick={() => setEditing({ draft: blankAgent(), isNew: true })}>{t('ui.team.new')}</button>
          </div>
        </div>
        {said && <p className="small muted">{said}</p>}
        {error && <div className="error" role="alert">{error}</div>}
        {!isWeb() && <Recommended config={config} save={save} />}
        <ul className="tm-list" aria-label={t('ui.team.listAria')}>
          {config.agents.team.map((a) => {
            // A draft of the assistant takes part in nothing, whatever a file lists on it: no way to edit it or to let it run, only to discard it.
            const draftCard = isDraft(a);
            const works = draftCard ? [] : stagesOfAgent(config, a);
            const squad = squads.find((s) => s.id === a.squad);
            const held = a.autonomous && squad && !squad.autonomy;
            return (
              <li key={a.id} className={`tm-card${editing?.draft.id === a.id && !editing.isNew ? ' tm-on' : ''}`}>
                <div className="tm-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="tm-card-title">
                      {agentName(a)} <span className="small muted mono">@{a.id}</span>
                      {a.system && <span className="badge badge-quiet" style={{ marginLeft: 8 }}>{t('ui.team.system')}</span>}
                      {draftCard && <span className="badge badge-block" style={{ marginLeft: 8 }}>{t('ui.team.draft')}</span>}
                    </div>
                    <div className="small muted tm-clamp">{shown(a.job) || t('ui.team.noJob')}</div>
                  </div>
                  {!draftCard && <button type="button" className="btn" disabled={!!assist} aria-label={t('ui.team.editAria', { name: agentName(a) })} onClick={() => setEditing({ draft: draftOf(a), isNew: false })}>{t('ui.team.edit')}</button>}
                  {draftCard && !isWeb() && (
                    <button type="button" className="btn tm-danger" disabled={assist?.testId === a.id} title={assist?.testId === a.id ? t('ui.team.draft.inUse') : undefined} aria-label={t('ui.team.draft.discardAria', { name: agentName(a) })} onClick={() => setDiscarding(a.id)}>{t('ui.team.draft.discard')}</button>
                  )}
                </div>
                <dl className="tm-meta">
                  <div><dt>{t('ui.team.squad')}</dt><dd>{squad ? squadName(squad) : t('ui.team.shared')}</dd></div>
                  <div><dt>{t('ui.team.stages')}</dt><dd>{works.length ? works.map((s) => s.label || s.id).join(', ') : t('ui.team.noStages')}</dd></div>
                  <div><dt>{t('ui.team.permission')}</dt><dd>{t(`ui.team.permission.${a.permission}`)}</dd></div>
                  {!a.system && <div><dt>{t('ui.team.tracker')}</dt><dd>{t(TRACKER_LABEL[a.tracker])}</dd></div>}
                  {!a.system && <div><dt>{t('ui.team.shell')}</dt><dd>{t(SHELL_LABEL[a.shell])}</dd></div>}
                  <div><dt>{t('ui.team.model')}</dt><dd>{modelText(config, a, t)}</dd></div>
                  <div><dt>{t('ui.team.turnsTo')}</dt><dd>{a.turnsTo ? agentNameById(config, a.turnsTo) : t('ui.team.thePerson')}</dd></div>
                </dl>
                {!draftCard && <Toggle checked={a.autonomous} onChange={(on) => void toggle(a, on)} label={t('ui.team.autonomy')} hint={held ? t('ui.team.heldBySquad') : undefined} />}
                {!draftCard && held && <div className="small muted">{t('ui.team.heldBySquad')}</div>}
                {draftCard && <p className="small muted">{t('ui.team.draft.hint')}</p>}
                {draftCard && discarding === a.id && <DiscardDraft name={agentName(a)} onConfirm={() => void discard(a)} onCancel={() => setDiscarding(null)} />}
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
          suggestionId={editing.suggestionId}
          assisted={editing.assisted}
          promote={editing.promote}
          // Adjusting with the AI is for an agent the person made, from the window, and not while an assistant is already open.
          onAssist={!isWeb() && !assist && !editing.isNew && !editing.assisted ? (form) => openAssist(form) : undefined}
          onSaved={editing.assisted ? assistSaved : undefined}
          save={save}
          onClose={() => setEditing(null)}
        />
      )}
      {!editing && assist && (
        <AgentAssist
          config={config}
          state={assist}
          update={(session, change) => setAssist((s) => (s && s.session === session ? change(s) : s))}
          reload={reload}
          onConclude={openEditor}
          onClose={closeAssist}
        />
      )}
    </div>
  );
}

/** What discarding a draft agent asks first: it deletes the agent and its conversation, and that cannot be undone. */
export function DiscardDraft({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  return (
    <Confirm danger confirmLabel={t('ui.team.draft.discard.confirm')} onConfirm={onConfirm} onCancel={onCancel}>
      <strong>{t('ui.team.draft.discard.title', { name })}</strong>
      <p>{t('ui.team.draft.discard.body')}</p>
    </Confirm>
  );
}

/**
 * The editor of one agent. Besides a new agent and an agent that exists it opens in two more ways, both from the assistant (`assisted`, which also shows the stages
 * the agent works): on a draft agent the assistant saved (`promote`, where saving takes the mark off and the id stays), and on an agent being adjusted (`isNew` false)
 * with the assistant's changes not yet saved. `onAssist` is given only where "Adjust with AI" is offered; `onSaved` runs after a save, before the panel closes.
 */
export function AgentPanel({ config, initial, isNew, suggestionId, assisted, promote, onAssist, onSaved, save, onClose }: { config: WorkspaceConfig; initial: AgentDraft; isNew: boolean; suggestionId?: string; assisted?: boolean; promote?: { id: string }; onAssist?: (form: AgentDraft) => void; onSaved?: () => void | Promise<void>; save: SectionProps['save']; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<AgentDraft>(initial);
  const [idTouched, setIdTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const system = !isNew && !promote && config.agents.team.find((a) => a.id === initial.id)?.system === true;
  const set = (patch: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const squads = squadsOf(config);

  const own = useMemo(() => agentProblems(config, draft, isNew), [config, draft, isNew]);
  const team = useMemo(() => teamIssues(config, draft, isNew, !!promote), [config, draft, isNew, promote]);
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
  const lost = useMemo(() => (isNew || system || promote ? [] : stagesLosingAgent(config, initial.id)), [config, initial.id, isNew, system, promote]);

  const run = async (make: () => WorkspaceConfig) => {
    setSaving(true);
    setError(null);
    try {
      await save(make());
      // An agent saved from a suggestion: the decision is recorded as "edited", with the id the editor gave it.
      if (suggestionId) await api.invoke('suggestions:edited', suggestionId, draft.id).catch(() => undefined);
      await onSaved?.();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const remove = () => run(() => removeAgent(config, initial.id));

  return (
    <SidePanel label={isNew || promote ? t('ui.team.panel.new') : t('ui.team.panel.edit', { name: agentName({ id: initial.id, name: initial.name }) })} onClose={onClose}>
      <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); if (!blocked) void run(() => (promote ? promoteDraft(config, draft) : applyAgent(config, draft, isNew))); }}>
        {assisted && <p className="small muted tm-assist-note" role="note">{t(promote ? 'ui.team.assist.editorNote.promote' : isNew ? 'ui.team.assist.editorNote.create' : 'ui.team.assist.editorNote.adjust')}</p>}
        {onAssist && !system && (
          <div className="tm-assist-offer">
            <button type="button" className="btn" disabled={saving} onClick={() => onAssist(draft)}>{t('ui.team.assist.adjust')}</button>
            <span className="small muted">{t('ui.team.assist.adjustHint')}</span>
          </div>
        )}
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

        <Labeled label={t('ui.team.f.permission')} hint={t(PERMISSION_HINT[draft.permission])}>
          {(id) => (
            <select id={id} className="text-input" value={draft.permission} onChange={(e) => set({ permission: e.target.value as AgentPermission, shell: shellAfterPermission(draft.shell, e.target.value as AgentPermission) })}>
              <option value="read">{t('ui.team.permission.read')}</option>
              <option value="worktree">{t('ui.team.permission.worktree')}</option>
            </select>
          )}
        </Labeled>
        <PermissionFields config={config} initial={initial} draft={draft} isNew={isNew} set={set} error={fieldError('shell')} />
        <Toggle checked={draft.autonomous} onChange={(autonomous) => set({ autonomous })} label={t('ui.team.autonomy')} />
        <p className="small muted">{t('ui.team.autonomyHint')}</p>
        <ToolsFields config={config} draft={draft} set={set} />
        {assisted && <StagesFields config={config} draft={draft} set={set} />}

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
          {!isNew && !system && !promote && !confirmDelete && <button type="button" className="btn tm-danger" onClick={() => setConfirmDelete(true)}>{t('ui.team.delete')}</button>}
        </div>
        {system && <p className="small muted">{t('ui.team.systemNote')}</p>}
      </form>
    </SidePanel>
  );
}

/**
 * The two permissions of a run: what the agent may read of the code host and what it may run. A value the person cannot give is not offered: `allowlist` is for an agent that
 * writes, `sandbox` only where this computer can make one, and from a paired browser nothing above what the agent has now (an agent made there has neither).
 */
function PermissionFields({ config, initial, draft, isNew, set, error }: { config: WorkspaceConfig; initial: AgentDraft; draft: AgentDraft; isNew: boolean; set: (p: Partial<AgentDraft>) => void; error?: string }) {
  const t = useT();
  const web = isWeb();
  const { status } = useSandboxStatus();
  const sandbox = status?.available === true;
  const was = { tracker: isNew ? 'none' : initial.tracker, shell: isNew ? 'none' : initial.shell } as { tracker: AgentTracker; shell: AgentShell };
  const trackerChoices = AGENT_TRACKERS.filter((v) => !web || v === draft.tracker || !trackerRaised(was.tracker, v));
  const shellChoices = AGENT_SHELLS.filter((v) => (v !== 'allowlist' || draft.permission === 'worktree' || draft.shell === v) && (v !== 'sandbox' || sandbox || draft.shell === v) && (!web || v === was.shell || v === 'none'));
  const sb = config.runner.sandbox;
  return (
    <>
      <Labeled label={t('ui.team.f.tracker')} hint={t(TRACKER_HINT[draft.tracker])}>
        {(id) => (
          <select id={id} className="text-input" value={draft.tracker} onChange={(e) => set({ tracker: e.target.value as AgentTracker })}>
            {trackerChoices.map((v) => <option key={v} value={v}>{t(TRACKER_LABEL[v])}</option>)}
          </select>
        )}
      </Labeled>
      <Labeled label={t('ui.team.f.shell')} hint={t(SHELL_HINT[draft.shell])} error={error}>
        {(id) => (
          <select id={id} className="text-input" value={draft.shell} onChange={(e) => set({ shell: e.target.value as AgentShell })}>
            {shellChoices.map((v) => <option key={v} value={v}>{t(SHELL_LABEL[v])}</option>)}
          </select>
        )}
      </Labeled>
      {draft.shell === 'sandbox' && (
        <p className="small muted">{t('ui.team.shell.sandboxSummary', { network: t(SANDBOX_NETWORK_LABEL[sb.network]), folders: sb.readOnlyPaths.length ? sb.readOnlyPaths.join(', ') : t('ui.runner.sandbox.pathsNone') })}{draft.permission === 'read' ? ` ${t('ui.team.shell.readerCopy')}` : ''}</p>
      )}
      {draft.allowedCommands.length > 0 && (
        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('ui.team.allowed.title')}</legend>
          <p className="small muted">{t('ui.team.allowed.hint')}</p>
          <ul className="team-allowed">
            {draft.allowedCommands.map((rule) => (
              <li key={rule} className="row spread">
                <code>{rule}</code>
                <button type="button" className="btn" aria-label={t('ui.team.allowed.removeAria', { rule })} onClick={() => set({ allowedCommands: draft.allowedCommands.filter((r) => r !== rule) })}>{t('ui.team.allowed.remove')}</button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {status && !status.available && !web && <p className="small muted">{t('ui.team.shell.noSandbox', { reason: t(SANDBOX_REASON_LABEL[status.reason ?? 'platform']) })}</p>}
      {status && !status.available && web && <p className="small muted">{t('ui.team.shell.noSandboxWeb')}</p>}
    </>
  );
}

/** The tools this agent uses: absent, it follows the workspace's; present, it overrides them field by field, so an agent may use one the workspace turned off. */
function ToolsFields({ config, draft, set }: { config: WorkspaceConfig; draft: AgentDraft; set: (p: Partial<AgentDraft>) => void }) {
  const t = useT();
  const own = draft.tools;
  const effective = own ?? config.agents.tools;
  const setTool = <K extends keyof AgentToolsConfig>(key: K, value: AgentToolsConfig[K]) => set({ tools: { ...effective, [key]: value } });
  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.team.tools')}</legend>
      <p className="small muted">{t('ui.team.tools.hint')}</p>
      <div role="group" aria-label={t('ui.team.tools')} className="wz-pills">
        <button type="button" aria-pressed={!own} className={`filter ${!own ? 'on' : ''}`} onClick={() => set({ tools: null })}>{t('ui.team.tools.inherit')}</button>
        <button type="button" aria-pressed={!!own} className={`filter ${own ? 'on' : ''}`} onClick={() => own || set({ tools: { ...config.agents.tools } })}>{t('ui.team.tools.own')}</button>
      </div>
      <Toggle checked={effective.files} onChange={(files) => setTool('files', files)} label={t('ui.team.tools.files')} hint={t('ui.team.tools.files.hint')} />
      <Toggle checked={effective.skills} onChange={(skills) => setTool('skills', skills)} label={t('ui.team.tools.skills')} hint={t('ui.team.tools.skills.hint')} />
      <Toggle checked={effective.vcsCli} onChange={(vcsCli) => setTool('vcsCli', vcsCli)} label={t('ui.team.tools.vcsCli')} hint={t('ui.team.tools.vcsCli.hint')} />
      <Toggle checked={effective.trackerMcp} onChange={(trackerMcp) => setTool('trackerMcp', trackerMcp)} label={t('ui.team.tools.trackerMcp')} hint={t('ui.team.tools.trackerMcp.hint')} />
      <Toggle checked={effective.subagents} onChange={(subagents) => setTool('subagents', subagents)} label={t('ui.team.tools.subagents')} hint={t('ui.team.tools.subagents.hint')} />
      {effective.trackerMcp && (
        <Labeled label={t('ui.team.tools.trackerMcpServer')} hint={t('ui.team.tools.trackerMcpServer.hint')}>
          {(id) => <input id={id} className="text-input mono" maxLength={100} spellCheck={false} value={effective.trackerMcpServer} onChange={(e) => setTool('trackerMcpServer', e.target.value)} />}
        </Labeled>
      )}
    </fieldset>
  );
}

/** The work stages of the flow the agent works, as boxes; shown when the editor comes from the assistant, which is where the stages are proposed (the flow editor is the other place that sets them). */
function StagesFields({ config, draft, set }: { config: WorkspaceConfig; draft: AgentDraft; set: (p: Partial<AgentDraft>) => void }) {
  const t = useT();
  const offered = offeredStages(config, draft.id || null);
  // A stage the agent lists that the flow no longer offers stays in the list, so the person can see it and take it away.
  const known = new Set(offered.map((s) => s.id));
  const gone = draft.stages.filter((id) => !known.has(id));
  const toggle = (id: string) => set({ stages: draft.stages.includes(id) ? draft.stages.filter((x) => x !== id) : [...draft.stages, id] });
  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.team.f.stages')}</legend>
      <p className="small muted">{t('ui.team.f.stagesHint')}</p>
      {offered.length + gone.length === 0 ? (
        <p className="small muted">{t('ui.team.f.stagesNone')}</p>
      ) : (
        <div className="tm-checks">
          {[...offered.map((s) => ({ id: s.id, label: shown(s.label) || s.id })), ...gone.map((id) => ({ id, label: id }))].map((s) => (
            <label key={s.id} className="tm-check">
              <input type="checkbox" checked={draft.stages.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
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
