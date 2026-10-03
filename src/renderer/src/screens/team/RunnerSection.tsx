import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunnerConfig } from '../../../../shared/config/types';
import { isFlowCycle } from '../../../../shared/runs/flow';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { draftOfRunner, MAX_CAP_MINUTES, MAX_IDLE_MINUTES, MAX_TURNS, MIN_CAP_MINUTES, MIN_TURNS, MIN_IDLE_MINUTES, runnerOf, runnerOfWeb, runnerProblems, withCommand, type RunnerDraft } from './runnerEdit';
import { ChipsInput, Labeled, Problems, Toggle, type Problem, type SectionProps } from './ui';

/**
 * Settings › Runner: what starts runs by itself, how many at once, where they work, which commands an agent that writes may run, and who its commits are made as.
 * In a paired browser the commands, the folder and the identity are shown and not edited: they decide what runs on the computer and where it reads.
 */
export function RunnerSection({ config, save }: SectionProps) {
  const t = useT();
  const web = isWeb();
  const [draft, setDraft] = useState<RunnerDraft>(() => draftOfRunner(config.runner));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const base = useMemo(() => JSON.stringify(draftOfRunner(config.runner)), [config.runner]);
  const dirty = JSON.stringify(draft) !== base;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(draftOfRunner(config.runner));
  }, [config.runner]);

  const set = (patch: Partial<RunnerDraft>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const issues = useMemo(() => runnerProblems(draft, isFlowCycle(config.devCycle.stages)), [draft, config.devCycle.stages]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const at = (field: string): string | undefined => {
    const hit = issues.filter((i) => i.field === field && i.severity === 'error');
    return hit.length ? hit.map((i) => t(i.key, i.params)).join(' ') : undefined;
  };
  const warnings: Problem[] = issues.filter((i) => i.severity === 'warning').map((i) => ({ severity: 'warning', text: t(i.key, i.params) }));
  const num = (v: string): number => (v === '' ? Number.NaN : Number(v));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const done = await save({ ...config, runner: web ? runnerOfWeb(draft, config.runner) : runnerOf(draft) });
      setDraft(draftOfRunner(done.runner));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); if (!errors && dirty) void submit(); }}>
      <p className="small muted">{t('ui.runner.hint')}</p>
      {web && <p className="small muted" role="note">{t('ui.runner.webNote')}</p>}
      <Toggle checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={t('ui.runner.enabled')} />
      <p className="small muted">{t('ui.runner.enabledHint')}</p>
      <div className="wz-two">
        <Labeled label={t('ui.runner.trigger')} hint={t('ui.runner.triggerHint')} error={at('triggerLabel')}>
          {(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={100} value={draft.triggerLabel} onChange={(e) => set({ triggerLabel: e.target.value })} />}
        </Labeled>
        <Labeled label={t('ui.runner.concurrent')} hint={t('ui.runner.concurrentHint')} error={at('maxConcurrentRuns')}>
          {(id) => <input id={id} type="number" min={1} max={10} className="text-input" value={Number.isNaN(draft.maxConcurrentRuns) ? '' : draft.maxConcurrentRuns} onChange={(e) => set({ maxConcurrentRuns: num(e.target.value) })} />}
        </Labeled>
      </div>
      {web ? (
        <WebOnComputer runner={config.runner} />
      ) : (
          <>
          <Labeled label={t('ui.runner.worktrees')} hint={t('ui.runner.worktreesHint')}>
            {(id) => <input id={id} className="text-input mono" spellCheck={false} placeholder={t('ui.runner.worktreesDefault')} value={draft.worktreesDir} onChange={(e) => set({ worktreesDir: e.target.value })} />}
          </Labeled>

          <fieldset className="wz-fieldset">
            <legend className="wz-label">{t('ui.runner.commands')}</legend>
            <div role="group" aria-label={t('ui.runner.commands')} className="wz-pills">
              <button type="button" aria-pressed={draft.commandsMode === 'repo'} className={`filter ${draft.commandsMode === 'repo' ? 'on' : ''}`} onClick={() => set({ commandsMode: 'repo' })}>{t('ui.runner.commandsRepo')}</button>
              <button type="button" aria-pressed={draft.commandsMode === 'custom'} className={`filter ${draft.commandsMode === 'custom' ? 'on' : ''}`} onClick={() => set({ commandsMode: 'custom' })}>{t('ui.runner.commandsCustom')}</button>
            </div>
            <p className="small muted">{draft.commandsMode === 'repo' ? t('ui.runner.commandsRepoHint') : t('ui.runner.commandsCustomHint')}</p>
            {draft.commandsMode === 'custom' && (
              <ChipsInput label={t('ui.runner.commandsList')} addLabel={t('ui.squads.f.labelAdd')} removeLabel={(command) => t('ui.runner.commandRemove', { command })} values={draft.commands} onChange={(commands) => set({ commands })} add={withCommand} error={at('commands')} />
            )}
          </fieldset>
          </>
      )}

      <div className="wz-two">
        <Labeled label={t('ui.runner.idle')} hint={t('ui.runner.idleHint', { min: MIN_IDLE_MINUTES, max: MAX_IDLE_MINUTES })} error={at('idle')}>
          {(id) => <input id={id} type="number" min={MIN_IDLE_MINUTES} max={MAX_IDLE_MINUTES} step={1} className="text-input" style={{ maxWidth: 160 }} value={Number.isNaN(draft.idleMinutes) ? '' : draft.idleMinutes} onChange={(e) => set({ idleMinutes: num(e.target.value) })} />}
        </Labeled>
        <Labeled label={t('ui.runner.cap')} hint={t('ui.runner.capHint', { min: MIN_CAP_MINUTES, max: MAX_CAP_MINUTES })} error={at('max')}>
          {(id) => <input id={id} type="number" min={MIN_CAP_MINUTES} max={MAX_CAP_MINUTES} step={1} className="text-input" style={{ maxWidth: 160 }} value={Number.isNaN(draft.maxMinutes) ? '' : draft.maxMinutes} onChange={(e) => set({ maxMinutes: num(e.target.value) })} />}
        </Labeled>
      </div>

      <div className="wz-two">
        <Labeled label={t('ui.runner.turnsRead')} hint={t('ui.runner.turnsReadHint', { min: MIN_TURNS, max: MAX_TURNS })} error={at('turns')}>
          {(id) => <input id={id} type="number" min={MIN_TURNS} max={MAX_TURNS} step={1} className="text-input" style={{ maxWidth: 160 }} value={Number.isNaN(draft.turnsRead) ? '' : draft.turnsRead} onChange={(e) => set({ turnsRead: num(e.target.value) })} />}
        </Labeled>
        <Labeled label={t('ui.runner.turnsWrite')} hint={t('ui.runner.turnsWriteHint', { min: MIN_TURNS, max: MAX_TURNS })}>
          {(id) => <input id={id} type="number" min={MIN_TURNS} max={MAX_TURNS} step={1} className="text-input" style={{ maxWidth: 160 }} value={Number.isNaN(draft.turnsWrite) ? '' : draft.turnsWrite} onChange={(e) => set({ turnsWrite: num(e.target.value) })} />}
        </Labeled>
      </div>

      {!web && (
        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('ui.runner.identity')}</legend>
          <p className="small muted">{t('ui.runner.identityHint')}</p>
          <div className="wz-two">
            <Labeled label={t('ui.runner.identityName')}>
              {(id) => <input id={id} className="text-input" maxLength={200} autoComplete="off" value={draft.identityName} onChange={(e) => set({ identityName: e.target.value })} />}
            </Labeled>
            <Labeled label={t('ui.runner.identityEmail')}>
              {(id) => <input id={id} type="email" className="text-input" maxLength={200} autoComplete="off" value={draft.identityEmail} onChange={(e) => set({ identityEmail: e.target.value })} />}
            </Labeled>
          </div>
          {at('identity') && <div className="tm-field-error small" role="alert">{at('identity')}</div>}
        </fieldset>
      )}

      <Labeled label={t('ui.runner.commit')} hint={t('ui.runner.commitHint')} error={at('commitMessage')}>
        {(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={200} value={draft.commitMessage} onChange={(e) => set({ commitMessage: e.target.value })} />}
      </Labeled>

      <Problems items={warnings} />
      {error && <div className="error" role="alert">{error}</div>}
      <div className="tm-savebar">
        <span className="small muted" role="status">{saved && !dirty ? t('ui.runner.saved') : errors > 0 ? t('ui.flow.blocked', { count: errors }) : dirty ? t('ui.flow.unsaved') : t('ui.flow.clean')}</span>
        <div className="wz-actions">
          {dirty && <button type="button" className="btn" onClick={() => setDraft(draftOfRunner(config.runner))}>{t('ui.flow.discard')}</button>}
          <button type="submit" className="btn btn-dark" disabled={!dirty || errors > 0 || saving}>{saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.save')}</button>
        </div>
      </div>
    </form>
  );
}

/** What only the computer changes, as a paired browser sees it: the folder for the runs, the commands an agent that writes may run and who the commits are made as. */
function WebOnComputer({ runner }: { runner: RunnerConfig }) {
  const t = useT();
  const identity = runner.identity.name || runner.identity.email ? `${runner.identity.name} <${runner.identity.email}>` : t('ui.runner.identityNone');
  return (
    <dl className="tm-readonly" aria-label={t('ui.runner.webOnComputer')}>
      <dt className="wz-label">{t('ui.runner.worktrees')}</dt>
      <dd className="mono small">{runner.worktreesDir ?? t('ui.runner.worktreesDefault')}</dd>
      <dt className="wz-label">{t('ui.runner.commands')}</dt>
      <dd className="small">
        {runner.commands === null ? t('ui.runner.commandsRepo') : runner.commands.length ? <ul className="tm-readonly-list">{runner.commands.map((c) => <li key={c} className="mono">{c}</li>)}</ul> : t('ui.runner.commandsNone')}
      </dd>
      <dt className="wz-label">{t('ui.runner.identity')}</dt>
      <dd className="small">{identity}</dd>
    </dl>
  );
}
