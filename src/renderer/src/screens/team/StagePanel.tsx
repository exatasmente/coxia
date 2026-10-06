import { useMemo, useState } from 'react';
import { newAgent } from '../../../../shared/config/team';
import { isWeb } from '../../platform';
import { LLM_ROLES, STAGE_KINDS, STAGE_TYPES, WAIT_KINDS, type AgentDef, type LlmRole, type StageDef, type StageType, type WaitKind } from '../../../../shared/config/types';
import { ISSUE_RECORD, isWork } from '../../../../shared/runs/flow';
import { flowIssueText, type FlowIssue } from '../../../../shared/runs/flowCheck';
import { useT } from '../../i18n';
import { slugOf, uniqueId } from './agentEdit';
import { DEFAULT_ROUND, stageFieldProblems } from './flowEdit';
import { KIND_LABEL, TYPE_HINT, TYPE_LABEL, WAIT_LABEL } from './labels';
import { agentName, shown } from './text';
import { ChipsInput, Labeled, SidePanel, Toggle } from './ui';

// The side panel of one stage: every field of the stage, the checks of the flow that are about it, and the agent made in place.

// What a run waits on by itself (a provider with no budget, a plugin's request): never an event a wait stage of the flow can be set to.
const RUN_ONLY_WAITS = new Set<WaitKind>(['budget', 'plugin']);

export interface StagePanelProps {
  stages: StageDef[];
  stage: StageDef;
  /** The agents this flow may use (a squad's members and the shared ones, or the whole team), the ones made while editing included. */
  team: AgentDef[];
  /** Every agent id of the workspace, taken or not by this flow: a new agent needs a free one. */
  takenIds: string[];
  /** The keys of the comment templates the workspace has. */
  commentKeys: string[];
  issues: FlowIssue[];
  onPatch: (patch: Partial<Record<keyof StageDef, unknown>>) => void;
  onRename: (id: string) => void;
  onCreateAgent: (agent: AgentDef) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onClose: () => void;
}

const addFile = (values: string[], text: string): string[] => {
  const v = text.trim();
  return v && !values.includes(v) ? [...values, v] : values;
};

export function StagePanel(p: StagePanelProps) {
  const t = useT();
  const { stage, stages } = p;
  const i = stages.findIndex((s) => s.id === stage.id);
  const type = stage.type ?? 'work';
  const work = type === 'work';
  const [idText, setIdText] = useState(stage.id);
  const [making, setMaking] = useState(false);

  const problems = useMemo(() => stageFieldProblems(stages, stage), [stages, stage]);
  const msg = (field: string): string | undefined => {
    const texts = [
      ...p.issues.filter((x) => x.stage === stage.id && x.field === field).map((x) => flowIssueText(x, t)),
      ...problems.filter((x) => x.field === field).map((x) => t(x.key, x.params)),
    ];
    return texts.length ? texts.join(' ') : undefined;
  };
  const others = stages.filter((s) => s.id !== stage.id);
  const earlierFiles = [ISSUE_RECORD, ...stages.slice(0, Math.max(i, 0)).flatMap((s) => s.produces ?? [])].filter((f, n, all) => all.indexOf(f) === n);
  const readsAll = stage.reads === undefined;

  const setType = (next: StageType) => {
    if (next === type) return;
    p.onPatch({
      type: next,
      ...(next !== 'work' ? { agentId: undefined, produces: undefined } : {}),
      ...(next === 'wait' ? { waitsFor: stage.waitsFor ?? { kind: 'pr-merged' } } : { waitsFor: undefined }),
    });
  };
  const setWait = (patch: { kind?: WaitKind; label?: string; minutes?: number }) => {
    const kind = patch.kind ?? stage.waitsFor?.kind ?? 'pr-merged';
    const label = 'label' in patch ? patch.label : stage.waitsFor?.label;
    const minutes = 'minutes' in patch ? patch.minutes : stage.waitsFor?.minutes;
    p.onPatch({ waitsFor: { kind, ...(kind === 'label' ? { label: label ?? '' } : {}), ...(kind === 'beta-age' && label?.trim() ? { label } : {}), ...(kind === 'time' || kind === 'beta-age' ? { minutes } : {}) } });
  };

  return (
    <SidePanel label={t('ui.flow.panel.title', { name: shown(stage.label) || stage.id })} onClose={p.onClose}>
      <div className="wz-stack">
        <Labeled label={t('ui.flow.f.name')}>
          {(id) => <input id={id} className="text-input" maxLength={100} value={shown(stage.label)} onChange={(e) => p.onPatch({ label: e.target.value })} />}
        </Labeled>
        <Labeled label={t('ui.flow.f.id')} hint={t('ui.flow.f.idHint')} error={msg('id')}>
          {(id) => (
            <input
              id={id}
              className="text-input mono"
              maxLength={48}
              spellCheck={false}
              value={idText}
              onChange={(e) => setIdText(e.target.value.trim())}
              onBlur={() => idText !== stage.id && idText && p.onRename(idText)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (idText !== stage.id && idText) p.onRename(idText); } }}
            />
          )}
        </Labeled>

        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('ui.flow.f.type')}</legend>
          <div role="group" aria-label={t('ui.flow.f.type')} className="wz-pills">
            {STAGE_TYPES.map((x) => (
              <button key={x} type="button" aria-pressed={type === x} className={`filter ${type === x ? 'on' : ''}`} onClick={() => setType(x)}>{t(TYPE_LABEL[x])}</button>
            ))}
          </div>
          <div className="small muted">{t(TYPE_HINT[type])}</div>
          {msg('type') && <div className="tm-field-error small" role="alert">{msg('type')}</div>}
        </fieldset>

        <Labeled label={t('ui.flow.f.kind')} hint={t('ui.flow.f.kindHint')}>
          {(id) => (
            <select id={id} className="text-input" value={stage.kind} onChange={(e) => p.onPatch({ kind: e.target.value })}>
              {STAGE_KINDS.map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
            </select>
          )}
        </Labeled>

        {work && (
          <div className="wz-stack">
            <Labeled label={t('ui.flow.f.agent')} hint={t('ui.flow.f.agentHint')} error={msg('agentId')}>
              {(id) => (
                <select id={id} className="text-input" value={stage.agentId ?? ''} onChange={(e) => p.onPatch({ agentId: e.target.value || undefined })}>
                  <option value="">{t('ui.flow.f.agentNone')}</option>
                  {p.team.map((a) => <option key={a.id} value={a.id}>{agentName(a)}</option>)}
                  {stage.agentId && !p.team.some((a) => a.id === stage.agentId) && <option value={stage.agentId}>{stage.agentId}</option>}
                </select>
              )}
            </Labeled>
            {!making && <div className="wz-actions"><button type="button" className="btn" onClick={() => setMaking(true)}>{t('ui.flow.f.agentCreate')}</button></div>}
            {making && (
              <NewAgentForm
                takenIds={p.takenIds}
                onCancel={() => setMaking(false)}
                onCreate={(a) => {
                  p.onCreateAgent(a);
                  p.onPatch({ agentId: a.id });
                  setMaking(false);
                }}
              />
            )}
          </div>
        )}

        {work && (
          <ChipsInput
            label={t('ui.flow.f.produces')}
            hint={t('ui.flow.f.producesHint')}
            addLabel={t('ui.squads.f.labelAdd')}
            removeLabel={(file) => t('ui.flow.f.fileRemove', { file })}
            values={stage.produces ?? []}
            onChange={(produces) => p.onPatch({ produces: produces.length ? produces : undefined })}
            add={addFile}
            error={msg('produces')}
          />
        )}

        {type !== 'wait' && (
          <fieldset className="wz-fieldset">
            <legend className="wz-label">{t('ui.flow.f.reads')}</legend>
            <div role="group" aria-label={t('ui.flow.f.reads')} className="wz-pills">
              <button type="button" aria-pressed={readsAll} className={`filter ${readsAll ? 'on' : ''}`} onClick={() => p.onPatch({ reads: undefined })}>{t('ui.flow.f.readsAll')}</button>
              <button type="button" aria-pressed={!readsAll} className={`filter ${!readsAll ? 'on' : ''}`} onClick={() => p.onPatch({ reads: stage.reads ?? [] })}>{t('ui.flow.f.readsSome')}</button>
            </div>
            {!readsAll && (
              <div className="tm-checks">
                {earlierFiles.map((f) => (
                  <label key={f} className="tm-check">
                    <input type="checkbox" checked={(stage.reads ?? []).includes(f)} onChange={(e) => p.onPatch({ reads: e.target.checked ? [...(stage.reads ?? []), f] : (stage.reads ?? []).filter((x) => x !== f) })} />
                    <span className="mono">{f}</span>
                  </label>
                ))}
                {(stage.reads ?? []).filter((f) => !earlierFiles.includes(f)).map((f) => (
                  <label key={f} className="tm-check">
                    <input type="checkbox" checked onChange={() => p.onPatch({ reads: (stage.reads ?? []).filter((x) => x !== f) })} />
                    <span className="mono">{f}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="small muted">{t('ui.flow.f.readsHint')}</div>
            {msg('reads') && <div className="tm-field-error small" role="alert">{msg('reads')}</div>}
          </fieldset>
        )}

        <Labeled label={t('ui.flow.f.next')} hint={t('ui.flow.f.nextHint')} error={msg('next')}>
          {(id) => (
            <select id={id} className="text-input" value={stage.next === undefined ? '::default' : stage.next === null ? '::end' : stage.next} onChange={(e) => p.onPatch({ next: e.target.value === '::default' ? undefined : e.target.value === '::end' ? null : e.target.value })}>
              <option value={'::default'}>{t('ui.flow.f.nextDefault')}</option>
              <option value={'::end'}>{t('ui.flow.f.nextEnd')}</option>
              {others.map((s) => <option key={s.id} value={s.id}>{shown(s.label) || s.id}</option>)}
              {typeof stage.next === 'string' && !others.some((s) => s.id === stage.next) && <option value={stage.next}>{stage.next}</option>}
            </select>
          )}
        </Labeled>

        {type !== 'wait' && (
          <>
            <Labeled label={t('ui.flow.f.returnsTo')} hint={t('ui.flow.f.returnsToHint')} error={msg('returnsTo')}>
              {(id) => (
                <select id={id} className="text-input" value={stage.returnsTo ?? ''} onChange={(e) => p.onPatch({ returnsTo: e.target.value || undefined })}>
                  <option value="">{t('ui.flow.f.returnsDefault')}</option>
                  {others.filter(isWork).map((s) => <option key={s.id} value={s.id}>{shown(s.label) || s.id}</option>)}
                  {stage.returnsTo && !others.some((s) => s.id === stage.returnsTo) && <option value={stage.returnsTo}>{stage.returnsTo}</option>}
                </select>
              )}
            </Labeled>
            <Labeled label={t('ui.flow.f.roundLimit')} hint={t('ui.flow.f.roundLimitHint', { count: DEFAULT_ROUND })} error={msg('roundLimit')}>
              {(id) => (
                <input id={id} type="number" min={1} max={20} className="text-input" style={{ maxWidth: 120 }} placeholder={String(DEFAULT_ROUND)} value={stage.roundLimit ?? ''} onChange={(e) => p.onPatch({ roundLimit: e.target.value === '' ? undefined : Number(e.target.value) })} />
              )}
            </Labeled>
          </>
        )}

        {type === 'wait' && (
          <fieldset className="wz-fieldset">
            <legend className="wz-label">{t('ui.flow.f.waitsFor')}</legend>
            <Labeled label={t('ui.flow.f.waitKind')}>
              {(id) => (
                <select id={id} className="text-input" value={stage.waitsFor?.kind ?? 'pr-merged'} onChange={(e) => setWait({ kind: e.target.value as WaitKind })}>
                  {WAIT_KINDS.filter((k) => !RUN_ONLY_WAITS.has(k)).map((k) => <option key={k} value={k}>{t(WAIT_LABEL[k])}</option>)}
                </select>
              )}
            </Labeled>
            {(stage.waitsFor?.kind === 'label' || stage.waitsFor?.kind === 'beta-age') && (
              <Labeled label={t(stage.waitsFor.kind === 'beta-age' ? 'ui.flow.f.waitBlockingLabel' : 'ui.flow.f.waitLabel')} hint={stage.waitsFor.kind === 'beta-age' ? t('ui.flow.f.waitBlockingLabelHint') : undefined}>
                {(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={200} value={stage.waitsFor?.label ?? ''} onChange={(e) => setWait({ label: e.target.value })} />}
              </Labeled>
            )}
            {(stage.waitsFor?.kind === 'time' || stage.waitsFor?.kind === 'beta-age') && (
              <Labeled label={t(stage.waitsFor.kind === 'beta-age' ? 'ui.flow.f.waitBetaMinutes' : 'ui.flow.f.waitMinutes')}>
                {(id) => <input id={id} type="number" min={1} className="text-input" style={{ maxWidth: 160 }} value={stage.waitsFor?.minutes ?? ''} onChange={(e) => setWait({ minutes: e.target.value === '' ? undefined : Number(e.target.value) })} />}
              </Labeled>
            )}
            {msg('waitsFor') && <div className="tm-field-error small" role="alert">{msg('waitsFor')}</div>}
          </fieldset>
        )}

        <Labeled label={t('ui.flow.f.comment')} hint={t('ui.flow.f.commentHint')} error={msg('comment')}>
          {(id) => (
            <select id={id} className="text-input" value={stage.comment === undefined ? '::default' : stage.comment === null || stage.comment === '' ? '::none' : stage.comment} onChange={(e) => p.onPatch({ comment: e.target.value === '::default' ? undefined : e.target.value === '::none' ? null : e.target.value })}>
              <option value={'::default'}>{t('ui.flow.f.commentDefault', { id: stage.id })}</option>
              <option value={'::none'}>{t('ui.flow.f.commentNone')}</option>
              {p.commentKeys.filter((k) => k !== stage.id).map((k) => <option key={k} value={k}>{k}</option>)}
              {typeof stage.comment === 'string' && stage.comment !== '' && !p.commentKeys.includes(stage.comment) && <option value={stage.comment}>{stage.comment}</option>}
            </select>
          )}
        </Labeled>
        <Labeled label={t('ui.flow.f.trackerStatus')} hint={t('ui.flow.f.trackerStatusHint')} error={msg('trackerStatus')}>
          {(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={200} value={stage.trackerStatus ?? ''} onChange={(e) => p.onPatch({ trackerStatus: e.target.value || undefined })} />}
        </Labeled>

        <div className="wz-actions">
          <button type="button" className="btn" onClick={p.onDuplicate}>{t('ui.flow.duplicate')}</button>
          <button type="button" className="btn tm-danger" onClick={p.onRemove}>{t('ui.flow.remove')}</button>
        </div>
      </div>
    </SidePanel>
  );
}

function NewAgentForm({ takenIds, onCreate, onCancel }: { takenIds: string[]; onCreate: (a: AgentDef) => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [job, setJob] = useState('');
  const [role, setRole] = useState<LlmRole>('deep');
  const [writes, setWrites] = useState(false);
  const [autonomous, setAutonomous] = useState(false);
  const id = uniqueId(slugOf(name), takenIds);
  return (
    <div className="wz-aside" role="group" aria-label={t('ui.flow.newAgent.title')}>
      <div className="wz-label">{t('ui.flow.newAgent.title')}</div>
      <Labeled label={t('ui.team.f.name')}>
        {(fid) => <input id={fid} className="text-input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}
      </Labeled>
      <Labeled label={t('ui.team.f.job')}>
        {(fid) => <textarea id={fid} className="text-input" rows={2} maxLength={1000} value={job} onChange={(e) => setJob(e.target.value)} />}
      </Labeled>
      <Labeled label={t('ui.team.model.role.label')} hint={t('ui.flow.newAgent.modelHint')}>
        {(fid) => (
          <select id={fid} className="text-input" value={role} onChange={(e) => setRole(e.target.value as LlmRole)}>
            {LLM_ROLES.map((r) => <option key={r} value={r}>{t(`ui.settings.role.${r}.label`)}</option>)}
          </select>
        )}
      </Labeled>
      <Toggle checked={writes} onChange={setWrites} label={t('ui.team.permission.worktree')} />
      <Toggle checked={autonomous} onChange={setAutonomous} label={t('ui.team.autonomy')} />
      <p className="small muted">{t('ui.flow.newAgent.idNote', { id })}</p>
      <div className="wz-actions">
        <button type="button" className="btn btn-dark" disabled={!name.trim()} onClick={() => onCreate(newAgent({ id, name: name.trim(), job: job.trim(), model: { role }, permission: writes ? 'worktree' : 'read', tracker: 'none', shell: !isWeb() && writes ? 'allowlist' : 'none', autonomous }))}>{t('ui.flow.newAgent.create')}</button>
        <button type="button" className="btn" onClick={onCancel}>{t('ui.team.cancel')}</button>
      </div>
    </div>
  );
}

