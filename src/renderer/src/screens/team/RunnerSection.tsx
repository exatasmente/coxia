import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunnerConfig, SandboxNetwork } from '../../../../shared/config/types';
import { SANDBOX_LIMIT_RANGES } from '../../../../shared/sandboxPaths';
import { proceduresOn } from '../../../../shared/procedures';
import { soleMaintainerOf } from '../../../../shared/release';
import { unconfinedOf } from '../../../../shared/unconfined';
import { isFlowCycle } from '../../../../shared/runs/flow';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { draftOfRunner, MAX_CAP_MINUTES, MAX_IDLE_MINUTES, MAX_TURNS, MIN_CAP_MINUTES, MIN_TURNS, MIN_IDLE_MINUTES, runnerOf, runnerOfWeb, runnerProblems, withCommand, type RunnerDraft } from './runnerEdit';
import { ChipsInput, Labeled, Problems, Toggle, type Problem, type SectionProps } from './ui';
import { SANDBOX_BROWSERS_LABEL, SANDBOX_DISPLAY_LABEL, SANDBOX_NETWORK_LABEL, SANDBOX_REASON_LABEL } from './labels';
import { AutonomyFields } from './AutonomyFields';
import { useSandboxStatus } from './sandboxStatus';

/**
 * Settings › Runner: what starts runs by itself, how many at once, where they work, which commands an agent that writes may run, and who its commits are made as.
 * In a paired browser the commands, the folder, the identity and the only maintainer switch are shown and not edited: they decide what runs on the computer and where it
 * reads, and whose yes stands for a review.
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

      <SandboxBlock draft={draft} set={set} stored={config.runner} web={web} at={at} />

      {!web && (
        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('ui.runner.evidence')}</legend>
          <p className="small muted">{t('ui.runner.evidenceHint')}</p>
          <div role="group" aria-label={t('ui.runner.evidence')} className="wz-pills">
            {(['app', 'cycle'] as const).map((where) => (
              <button key={where} type="button" aria-pressed={draft.evidence === where} className={`filter ${draft.evidence === where ? 'on' : ''}`} onClick={() => set({ evidence: where })}>{t(where === 'app' ? 'ui.runner.evidenceApp' : 'ui.runner.evidenceCycle')}</button>
            ))}
          </div>
          <p className="small muted">{draft.evidence === 'app' ? t('ui.runner.evidenceAppHint') : t('ui.runner.evidenceCycleHint')}</p>
        </fieldset>
      )}

      <AutonomyBlock draft={draft} set={set} stored={config.runner} web={web} />

      <Labeled label={t('ui.runner.commit')} hint={t('ui.runner.commitHint')} error={at('commitMessage')}>
        {(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={200} value={draft.commitMessage} onChange={(e) => set({ commitMessage: e.target.value })} />}
      </Labeled>

      <Labeled label={t('ui.runner.prTitle')} hint={t('ui.runner.prTitleHint')} error={at('prTitle')}>
        {(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={200} value={draft.prTitle} onChange={(e) => set({ prTitle: e.target.value })} />}
      </Labeled>

      <Toggle checked={draft.linkDependencies} onChange={(linkDependencies) => set({ linkDependencies })} label={t('ui.runner.linkDeps')} />
      <p className="small muted">{t('ui.runner.linkDepsHint')}</p>

      {!web && (
        <>
          <Toggle checked={draft.soleMaintainer} onChange={(soleMaintainer) => set({ soleMaintainer })} label={t('ui.runner.soleMaintainer')} />
          <p className="small muted">{t('ui.runner.soleMaintainerHint')}</p>
          <Toggle checked={draft.procedures} onChange={(procedures) => set({ procedures })} label={t('ui.runner.procedures')} />
          <p className="small muted">{t('ui.runner.proceduresHint')}</p>
          <Toggle checked={draft.unconfined} onChange={(unconfined) => set({ unconfined })} label={t('ui.runner.unconfined')} />
          <p className="small muted">{t('ui.runner.unconfinedHint')}</p>
        </>
      )}

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

/**
 * What only the computer changes, as a paired browser sees it: the folder for the runs, the commands an agent that writes may run, who the commits are made as and whether
 * the person's yes stands for the review of a release merge.
 */
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
      <dt className="wz-label">{t('ui.runner.soleMaintainer')}</dt>
      <dd className="small">{t(soleMaintainerOf(runner) ? 'ui.runner.soleMaintainerOn' : 'ui.runner.soleMaintainerOff')}</dd>
      <dt className="wz-label">{t('ui.runner.procedures')}</dt>
      <dd className="small">{t(proceduresOn({ runner }) ? 'ui.runner.proceduresOn' : 'ui.runner.proceduresOff')}</dd>
      <dt className="wz-label">{t('ui.runner.unconfined')}</dt>
      <dd className="small">{t(unconfinedOf(runner) ? 'ui.runner.unconfinedOn' : 'ui.runner.unconfinedOff')}</dd>
      <dt className="wz-label">{t('ui.runner.evidence')}</dt>
      <dd className="small">{t(runner.evidence === 'cycle' ? 'ui.runner.evidenceCycle' : 'ui.runner.evidenceApp')}</dd>
    </dl>
  );
}

/**
 * The workspace's autonomy block: what an ordinary run may do without stopping for the person. A paired browser is shown it and cannot change it (the save is
 * refused), because letting a run push, open a pull request or keep the machine's shell without being asked is a decision that stays on the computer.
 */
function AutonomyBlock({ draft, set, stored, web }: { draft: RunnerDraft; set: (p: Partial<RunnerDraft>) => void; stored: RunnerConfig; web: boolean }) {
  const t = useT();
  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.autonomy.title')}</legend>
      <p className="small muted">{t('ui.autonomy.hint')}</p>
      <AutonomyFields value={web ? stored.autonomy : draft.autonomy} onChange={(patch) => set({ autonomy: { ...draft.autonomy, ...patch } })} readOnly={web} />
      <div className="wz-stack">
        <p className="wz-label">{t('ui.autonomy.board.heading')}</p>
        <Toggle checked={(web ? stored.autonomy : draft.autonomy).board} onChange={(board) => set({ autonomy: { ...draft.autonomy, board } })} label={t('ui.autonomy.board')} disabled={web} />
        <p className="small muted">{t('ui.autonomy.board.hint')}</p>
      </div>
      {web && <p className="small muted" role="note">{t('ui.autonomy.webNote')}</p>}
    </fieldset>
  );
}

const LIMIT_FIELDS = [
  ['commandMs', 'ui.runner.sandbox.limit.commandMs', 1000],
  ['stageMs', 'ui.runner.sandbox.limit.stageMs', 60_000],
  ['memoryMb', 'ui.runner.sandbox.limit.memoryMb', 1],
  ['processes', 'ui.runner.sandbox.limit.processes', 1],
  ['fileMb', 'ui.runner.sandbox.limit.fileMb', 1],
  ['copyMb', 'ui.runner.sandbox.limit.copyMb', 1],
] as const;

/**
 * What the sandbox of an agent that runs commands may reach and use. Only the computer changes it: a paired browser is shown what is set. The network switch is a window to
 * the listed hosts only (through a filtering proxy), and the text next to it says so.
 */
function SandboxBlock({ draft, set, stored, web, at }: { draft: RunnerDraft; set: (p: Partial<RunnerDraft>) => void; stored: RunnerConfig; web: boolean; at: (field: string) => string | undefined }) {
  const t = useT();
  const { status, check, checking } = useSandboxStatus();
  const sb = web ? stored.sandbox : draft.sandbox;
  const setSb = (patch: Partial<RunnerDraft['sandbox']>) => set({ sandbox: { ...draft.sandbox, ...patch } });
  const num = (v: string): number => (v === '' ? Number.NaN : Number(v));
  const network: SandboxNetwork = sb.network;
  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.runner.sandbox')}</legend>
      <p className="small muted">{t('ui.runner.sandbox.hint')}</p>
      <p className="small" role="status">
        {status === null ? t('ui.runner.sandbox.checking') : status.available ? t('ui.runner.sandbox.available', { version: status.version ?? '' }) : t('ui.runner.sandbox.unavailable', { reason: t(SANDBOX_REASON_LABEL[status.reason ?? 'platform']) })}
        {!web && <button type="button" className="btn" style={{ marginLeft: 8 }} disabled={checking} onClick={check}>{t('ui.runner.sandbox.check')}</button>}
      </p>
      {status?.gui && (
        <>
          <p className="small" role="status">{t(SANDBOX_BROWSERS_LABEL[status.gui.browsers])}</p>
          <p className="small" role="status">{t(SANDBOX_DISPLAY_LABEL[status.gui.display])}</p>
        </>
      )}
      {web ? (
        <dl className="tm-readonly" aria-label={t('ui.runner.webOnComputer')}>
          <dt className="wz-label">{t('ui.runner.sandbox.network')}</dt>
          <dd className="small">{t(SANDBOX_NETWORK_LABEL[network])}</dd>
          <dt className="wz-label">{t('ui.runner.sandbox.hosts')}</dt>
          <dd className="mono small">{sb.registryHosts.join(', ') || '—'}</dd>
          <dt className="wz-label">{t('ui.runner.sandbox.paths')}</dt>
          <dd className="mono small">{sb.readOnlyPaths.join(', ') || t('ui.runner.sandbox.pathsNone')}</dd>
          <dt className="wz-label">{t('ui.runner.sandbox.browsers')}</dt>
          <dd className="mono small">{sb.browsersPath || '—'}</dd>
          <dt className="wz-label">{t('ui.runner.sandbox.display')}</dt>
          <dd className="small">{t(sb.display ? 'ui.runner.sandbox.displayOn' : 'ui.runner.sandbox.displayOff')}</dd>
        </dl>
      ) : (
        <>
          <div role="group" aria-label={t('ui.runner.sandbox.network')} className="wz-pills">
            {(['off', 'registry', 'open'] as const).map((n) => (
              <button key={n} type="button" aria-pressed={network === n} className={`filter ${network === n ? 'on' : ''}`} onClick={() => setSb({ network: n })}>{t(SANDBOX_NETWORK_LABEL[n])}</button>
            ))}
          </div>
          <p className="small muted">{network === 'off' ? t('ui.runner.sandbox.network.off.hint') : network === 'open' ? t('ui.runner.sandbox.network.open.hint') : t('ui.runner.sandbox.network.registry.hint')}</p>
          {network === 'registry' && (
            <ChipsInput label={t('ui.runner.sandbox.hosts')} addLabel={t('ui.squads.f.labelAdd')} removeLabel={(host) => t('ui.runner.sandbox.hostRemove', { host })} values={sb.registryHosts} onChange={(registryHosts) => setSb({ registryHosts })} add={(list, text) => (text.trim() && !list.includes(text.trim().toLowerCase()) ? [...list, text.trim().toLowerCase()] : list)} error={at('sandboxHosts')} />
          )}
          <ChipsInput label={t('ui.runner.sandbox.paths')} addLabel={t('ui.squads.f.labelAdd')} removeLabel={(path) => t('ui.runner.sandbox.pathRemove', { path })} values={sb.readOnlyPaths} onChange={(readOnlyPaths) => setSb({ readOnlyPaths })} add={(list, text) => (text.trim() && !list.includes(text.trim()) ? [...list, text.trim()] : list)} error={at('sandboxPaths')} />
          <p className="small muted">{t('ui.runner.sandbox.pathsHint')}</p>
          <Labeled label={t('ui.runner.sandbox.browsers')} hint={t('ui.runner.sandbox.browsersHint')}>
            {(id) => <input id={id} className="text-input mono" value={sb.browsersPath ?? ''} onChange={(e) => setSb({ browsersPath: e.target.value || null })} />}
          </Labeled>
          {at('sandboxBrowsers') && <div className="tm-field-error small" role="alert">{at('sandboxBrowsers')}</div>}
          <Toggle checked={sb.display === true} onChange={(display) => setSb({ display })} label={t('ui.runner.sandbox.display')} />
          <p className="small muted">{t('ui.runner.sandbox.displayHint')}</p>
          {(sb.browsersPath || sb.display) && sb.limits.memoryMb < 1024 && <p className="small" role="note">{t('ui.runner.sandbox.memoryLow')}</p>}
          <div className="wz-two">
            {LIMIT_FIELDS.map(([key, label, unit]) => {
              const [min, max] = SANDBOX_LIMIT_RANGES[key];
              const shown = draft.sandbox.limits[key] / unit;
              return (
                <Labeled key={key} label={t(label)} hint={t('ui.runner.sandbox.limitRange', { min: min / unit, max: max / unit })}>
                  {(id) => <input id={id} type="number" min={min / unit} max={max / unit} step={1} className="text-input" style={{ maxWidth: 160 }} value={Number.isNaN(shown) ? '' : shown} onChange={(e) => setSb({ limits: { ...draft.sandbox.limits, [key]: Math.round(num(e.target.value) * unit) } })} />}
                </Labeled>
              );
            })}
          </div>
          {at('sandboxLimits') && <div className="tm-field-error small" role="alert">{at('sandboxLimits')}</div>}
        </>
      )}
    </fieldset>
  );
}
