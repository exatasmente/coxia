import { useEffect, useMemo, useRef, useState } from 'react';
import { squadsOf } from '../../../../shared/config/squads';
import type { AgentDef, StageDef, StageType } from '../../../../shared/config/types';
import { flowOf } from '../../../../shared/runs/flow';
import { flowIssueText } from '../../../../shared/runs/flowCheck';
import { squadIssueText } from '../../../../shared/runs/squadCheck';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { Notice } from '../../wizard/ui';
import { Diagram } from '../Diagram';
import { flowDiagram } from './flowDiagram';
import {
  applyFlows, chainRename, checkFlows, draftOfFlows, dropOwnFlow, duplicateStage, giveOwnFlow, insertStage, moveStage, ownsFlow, patchStage, removeStage, renameStage,
  flowTeam, stagesOfTarget, withAutonomy, withStages, autonomyOfTarget, type FlowDraft, type Target,
} from './flowEdit';
import { applyBundle, exportFlowText, readFlowText, STARTERS, type FlowBundle } from './flowFile';
import { NEW_STAGE_LABEL, TYPE_LABEL, WAIT_LABEL } from './labels';
import { AutonomyFields } from './AutonomyFields';
import { StagePanel } from './StagePanel';
import { agentName, shown, squadName } from './text';
import { Confirm, Problems, Toggle, type Problem, type SectionProps } from './ui';

type Translate = ReturnType<typeof useT>;

const download = (filename: string, text: string): void => {
  const a = document.createElement('a');
  a.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

interface Replacement {
  name: string;
  bundle: FlowBundle;
}

/** Settings › Flow: the stages of the cycle as a list and a diagram, the fields of each in a panel, the checks while editing, and the flow of a squad. */
export function FlowEditor({ config, save, squad }: SectionProps & { squad?: string }) {
  const t = useT();
  const squads = squadsOf(config);
  const [target, setTarget] = useState<Target>(squad && squads.some((s) => s.id === squad) ? squad : null);
  const [draft, setDraft] = useState<FlowDraft>(() => draftOfFlows(config));
  const [selected, setSelected] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<Replacement | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [announce, setAnnounce] = useState('');
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // The squad the person came for (from the squads list or another screen).
  useEffect(() => {
    if (squad && squads.some((s) => s.id === squad)) setTarget(squad);
    // only a new request moves the target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squad]);

  const base = useMemo(() => JSON.stringify(draftOfFlows(config)), [config]);
  const dirty = JSON.stringify(draft) !== base;
  // A change made elsewhere (a save, an import) replaces the draft only while there is nothing of the person's in it.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(draftOfFlows(config));
  }, [config]);
  useEffect(() => {
    if (target && !squads.some((s) => s.id === target)) setTarget(null);
  }, [target, squads]);

  const stages = stagesOfTarget(draft, target);
  const view = useMemo(() => applyFlows(config, draft), [config, draft]);
  const team: AgentDef[] = useMemo(() => flowTeam(view, target), [view, target]);
  const checks = useMemo(() => checkFlows(config, draft, target), [config, draft, target]);
  const flow = useMemo(() => flowOf({ agents: { team }, devCycle: { stages } }, stages), [team, stages]);
  const code = useMemo(
    () => (stages.length ? flowDiagram(stages, team, agentName, { returns: t('ui.flow.diagram.returns') }) : ''),
    // the words change with the language
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages, team, t('ui.flow.diagram.returns')],
  );
  const current = stages.find((s) => s.id === selected) ?? null;
  const own = ownsFlow(draft, target);
  const autonomy = autonomyOfTarget(draft, target);
  const targetName = target ? squadName(squads.find((s) => s.id === target) ?? { id: target, name: target }) : t('ui.flow.target.workspace');

  const edit = (next: StageDef[]) => {
    setSaved(false);
    setDraft((d) => withStages(d, target, next));
  };
  const change = (next: FlowDraft) => {
    setSaved(false);
    setDraft(next);
  };

  const add = (after: number, type: StageType) => {
    const made = insertStage(stages, after, type, t(NEW_STAGE_LABEL[type]));
    edit(made.stages);
    setSelected(made.id);
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    edit(moveStage(stages, from, to));
    setAnnounce(t('ui.flow.moved', { name: shown(stages[from].label) || stages[from].id, position: to + 1, total: stages.length }));
  };
  const duplicate = (id: string) => {
    const made = duplicateStage(stages, id, t('ui.flow.copyOf', { name: shown(stages.find((s) => s.id === id)?.label ?? id) }));
    edit(made.stages);
    setSelected(made.id);
  };
  const remove = (id: string) => {
    edit(removeStage(stages, id));
    if (selected === id) setSelected(null);
  };
  const rename = (from: string, to: string) => {
    if (stages.some((s) => s.id === to)) return;
    setSaved(false);
    setDraft((d) => ({ ...withStages(d, target, renameStage(stagesOfTarget(d, target), from, to)), renames: chainRename(d.renames, from, to) }));
    setSelected(to);
  };

  const replaceWith = (r: Replacement) => {
    change(applyBundle(draft, config, target, r.bundle));
    setSelected(null);
    setReplacing(null);
  };
  const pickStarter = (id: string) => {
    const s = STARTERS.find((x) => x.id === id);
    if (s) setReplacing({ name: shown(s.name), bundle: s.bundle() });
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const read = readFlowText(await f.text());
    if (read.ok) {
      setImportErrors(null);
      setReplacing({ name: f.name, bundle: read.bundle });
    } else {
      setImportErrors(read.notFlow ? [t('ui.flow.import.notFlow')] : read.errors);
    }
    if (file.current) file.current.value = '';
  };
  const exportFile = () => {
    const id = target ? `flow-${target}` : 'workspace-flow';
    download(`coxia-flow-${id}.json`, exportFlowText(view, stages, { id, name: targetName }, new Date()));
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const done = await save(applyFlows(config, draft));
      setDraft(draftOfFlows(done));
      setSaved(true);
      setSelected(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const general: Problem[] = checks.general.map((g) => ({ severity: g.issue.severity, text: g.type === 'flow' ? flowIssueText(g.issue, t) : squadIssueText(g.issue, t) }));
  const rowIssues = (id: string) => checks.rows.filter((i) => i.stage === id).map((i) => ({ severity: i.severity, text: flowIssueText(i, t) }));
  const wholeFlow = checks.rows.filter((i) => i.stage === null).map((i) => ({ severity: i.severity, text: flowIssueText(i, t) }));
  const commentKeys = useMemo(() => Object.keys({ ...view.devCycle.comments, ...draft.comments }).sort(), [view, draft.comments]);

  return (
    <div className="wz-stack">
      <Notice tone="info">{t('ui.flow.runsNote')}</Notice>

      <div className="tm-bar">
        <label className="tm-bar-item">
          <span className="wz-label">{t('ui.flow.target')}</span>
          <select className="text-input" value={target ?? ''} onChange={(e) => { setTarget(e.target.value || null); setSelected(null); }}>
            <option value="">{t('ui.flow.target.workspace')}</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{t(ownsFlow(draft, s.id) ? 'ui.flow.target.squadOwn' : 'ui.flow.target.squad', { name: squadName(s) })}</option>)}
          </select>
        </label>
        <label className="tm-bar-item">
          <span className="wz-label">{t('ui.flow.starter')}</span>
          <select className="text-input" value="" onChange={(e) => e.target.value && pickStarter(e.target.value)} disabled={!own}>
            <option value="">{t('ui.flow.starter.pick')}</option>
            {STARTERS.map((s) => <option key={s.id} value={s.id}>{shown(s.name)}</option>)}
          </select>
        </label>
        <div className="tm-bar-actions">
          <button type="button" className="btn" disabled={!own || !stages.length} onClick={exportFile}>{t('ui.flow.export')}</button>
          <button type="button" className="btn" disabled={!own} onClick={() => file.current?.click()}>{t('ui.flow.import')}</button>
          <input ref={file} type="file" accept=".json,application/json" className="wz-sr" tabIndex={-1} aria-label={t('ui.flow.import')} onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      </div>

      {importErrors && (
        <Notice tone="error" role="alert">
          <div>{t('ui.flow.import.failed')}</div>
          <ul className="wz-list">{importErrors.map((m, i) => <li key={i} className="wz-wrap-anywhere">{m}</li>)}</ul>
        </Notice>
      )}
      {replacing && (
        <Confirm confirmLabel={t('ui.flow.replace.confirm')} onConfirm={() => replaceWith(replacing)} onCancel={() => setReplacing(null)}>
          <strong>{t('ui.flow.replace.title', { name: replacing.name, target: targetName })}</strong>
          <p>{t('ui.flow.replace.body')}</p>
        </Confirm>
      )}

      {target && !own && (
        <div className="panel">
          <p>{t('ui.flow.squadFollows', { name: targetName })}</p>
          <div className="wz-actions"><button type="button" className="btn btn-dark" onClick={() => change(giveOwnFlow(draft, target))}>{t('ui.flow.squadGive')}</button></div>
        </div>
      )}
      {target && own && (
        <div className="row spread">
          <p className="small muted" style={{ flex: '1 1 240px' }}>{t('ui.flow.squadOwn', { name: targetName })}</p>
          {!confirmDrop && <button type="button" className="btn" onClick={() => setConfirmDrop(true)}>{t('ui.flow.squadDrop')}</button>}
        </div>
      )}

      {(!target || own) && (
        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('ui.autonomy.title')}</legend>
          <p className="small muted">{t('ui.autonomy.flow.hint', { name: targetName })}</p>
          <Toggle checked={autonomy.useWorkspace} onChange={(useWorkspace) => change(withAutonomy(draft, target, { useWorkspace }))} label={t('ui.autonomy.flow.useWorkspace')} />
          <p className="small muted">{t('ui.autonomy.flow.useWorkspace.hint')}</p>
          <AutonomyFields value={autonomy} onChange={(patch) => change(withAutonomy(draft, target, patch))} disabled={autonomy.useWorkspace} disabledHint={t('ui.autonomy.byWorkspace')} />
        </fieldset>
      )}
      {confirmDrop && target && (
        <Confirm confirmLabel={t('ui.flow.squadDrop.confirm')} onConfirm={() => { change(dropOwnFlow(draft, target)); setConfirmDrop(false); setSelected(null); }} onCancel={() => setConfirmDrop(false)}>
          <strong>{t('ui.flow.squadDrop.title', { name: targetName })}</strong>
          <p>{t('ui.flow.squadDrop.body')}</p>
        </Confirm>
      )}

      {(own || !target) && (
        <div className="tm-split tm-flow" data-open="true">
          <div className="wz-stack">
            <p className="small muted">{t('ui.flow.listHint')}</p>
            {stages.length === 0 && <p className="panel small muted">{t('ui.flow.empty')}</p>}
            <ol className="tm-stages" aria-label={t('ui.flow.listAria', { name: targetName })}>
              <li className="tm-gap"><AddButtons after={-1} name={t('ui.flow.atStart')} add={add} t={t} /></li>
              {stages.map((s, i) => {
                const f = flow[i];
                const agent = f?.agent ? team.find((a) => a.id === f.agent) : undefined;
                const issues = rowIssues(s.id);
                const type = s.type ?? 'work';
                const name = shown(s.label) || s.id;
                return (
                  <li key={s.id} className="tm-gap-wrap">
                    <div
                      className={`tm-row${selected === s.id ? ' tm-on' : ''}${dropAt === i ? ' tm-drop' : ''}${issues.some((x) => x.severity === 'error') ? ' tm-bad' : ''}`}
                      draggable
                      onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
                      onDragOver={(e) => { if (dragFrom.current !== null) { e.preventDefault(); setDropAt(i); } }}
                      onDragLeave={() => setDropAt((d) => (d === i ? null : d))}
                      onDrop={(e) => { e.preventDefault(); const from = dragFrom.current; dragFrom.current = null; setDropAt(null); if (from !== null) move(from, i); }}
                      onDragEnd={() => { dragFrom.current = null; setDropAt(null); }}
                    >
                      <button type="button" className="tm-row-main" aria-pressed={selected === s.id} onClick={() => setSelected(selected === s.id ? null : s.id)}>
                        <span className="tm-row-num" aria-hidden="true">{i + 1}</span>
                        <span className="tm-row-body">
                          <span className="tm-row-name">{name}</span>
                          <span className="small muted tm-row-sub">
                            <span className={`badge badge-quiet tm-type tm-type-${type}`}>{t(TYPE_LABEL[type])}</span>
                            {type === 'work' && <span>{agent ? agentName(agent) : t('ui.flow.row.noAgent')}</span>}
                            {type === 'wait' && s.waitsFor && <span>{t(WAIT_LABEL[s.waitsFor.kind])}</span>}
                            {s.produces?.length ? <span className="mono">{s.produces.join(', ')}</span> : null}
                            {f?.returnsTo && (type === 'gate' || s.returnsTo !== undefined || s.kind === 'review' || s.kind === 'qa') ? <span>{t('ui.flow.row.returns', { stage: shown(stages.find((x) => x.id === f.returnsTo)?.label ?? '') || f.returnsTo })}</span> : null}
                          </span>
                        </span>
                      </button>
                      <div className="tm-row-actions">
                        <button type="button" className="btn tm-mini" aria-label={t('ui.flow.up', { name })} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                        <button type="button" className="btn tm-mini" aria-label={t('ui.flow.down', { name })} disabled={i === stages.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                        <button type="button" className="btn tm-mini" aria-label={t('ui.flow.duplicateAria', { name })} onClick={() => duplicate(s.id)}>⧉</button>
                        <button type="button" className="btn tm-mini tm-danger" aria-label={t('ui.flow.removeAria', { name })} onClick={() => remove(s.id)}>×</button>
                      </div>
                      {issues.length > 0 && <div className="tm-row-issues"><Problems items={issues} /></div>}
                    </div>
                    <div className="tm-gap"><AddButtons after={i} name={name} add={add} t={t} /></div>
                  </li>
                );
              })}
            </ol>
            <p className="wz-sr" role="status" aria-live="polite">{announce}</p>

            <Problems items={[...wholeFlow, ...general]} />
            {error && <div className="error" role="alert">{error}</div>}
            <div className="tm-savebar">
              <span className="small muted" role="status">
                {saved && !dirty ? t('ui.flow.saved') : checks.errors > 0 ? t('ui.flow.blocked', { count: checks.errors }) : dirty ? t('ui.flow.unsaved') : t('ui.flow.clean')}
              </span>
              <div className="wz-actions">
                {dirty && <button type="button" className="btn" onClick={() => { setDraft(draftOfFlows(config)); setSelected(null); setReplacing(null); }}>{t('ui.flow.discard')}</button>}
                <button type="button" className="btn btn-dark" disabled={!dirty || checks.errors > 0 || saving} onClick={() => void submit()}>{saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.flow.save')}</button>
              </div>
            </div>
          </div>

          <div className="tm-flow-side">
            <div className="wz-stack tm-diagram-box">
              <div className="wz-label">{t('ui.flow.diagram')}</div>
              {code ? <Diagram code={code} repair={false} /> : <p className="small muted">{t('ui.flow.diagram.empty')}</p>}
              <p className="small muted">{t('ui.flow.diagram.legend')}</p>
            </div>
            {current && (
              <StagePanel
                key={current.id}
                stages={stages}
                stage={current}
                team={team}
                takenIds={[...config.agents.team, ...draft.newAgents].map((a) => a.id)}
                commentKeys={commentKeys}
                issues={checks.rows}
                onPatch={(patch) => edit(patchStage(stages, current.id, patch))}
                onRename={(to) => rename(current.id, to)}
                onCreateAgent={(a) => change({ ...draft, newAgents: [...draft.newAgents, a] })}
                onDuplicate={() => duplicate(current.id)}
                onRemove={() => remove(current.id)}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddButtons({ after, name, add, t }: { after: number; name: string; add: (after: number, type: StageType) => void; t: Translate }) {
  return (
    <div className="tm-add" role="group" aria-label={t('ui.flow.addAria', { name })}>
      {(['work', 'gate', 'wait'] as const).map((type) => (
        <button key={type} type="button" className="btn tm-mini tm-add-btn" aria-label={t('ui.flow.addTypeAria', { type: t(TYPE_LABEL[type]), name })} onClick={() => add(after, type)}>+ {t(TYPE_LABEL[type])}</button>
      ))}
    </div>
  );
}
