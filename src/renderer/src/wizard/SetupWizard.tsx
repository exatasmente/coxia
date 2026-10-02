import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceConfig } from '../../../shared/config/types';
import { LLM_ROLES } from '../../../shared/config/types';
import type { ConfigView } from '../../../shared/configView';
import { SDK_EVENT, SKIPPABLE_STEPS, type SdkEvent, type WizardAvailability, type WizardProgress, type WizardStepId, emptyProgress, visibleSteps } from '../../../shared/wizard';
import { errorText, moduleEvents } from '../api';
import { applyLanguage, useT } from '../i18n';
import { isWeb } from '../platform';
import { BackIcon } from '../screens/icons';
import { CycleStep } from './steps/CycleStep';
import { DocsStep } from './steps/DocsStep';
import { IntegrationsStep } from './steps/IntegrationsStep';
import { LanguageStep } from './steps/LanguageStep';
import { ModelsStep } from './steps/ModelsStep';
import { ProjectsStep } from './steps/ProjectsStep';
import { ReviewStep } from './steps/ReviewStep';
import { SdkStep } from './steps/SdkStep';
import { VoiceStep } from './steps/VoiceStep';
import { Notice } from './ui';
import { wizardApi } from './wizardApi';
import './wizard.css';

export interface StepProps {
  cfg: WorkspaceConfig;
  setCfg: (change: (c: WorkspaceConfig) => WorkspaceConfig) => void;
  view: ConfigView;
  refreshView: () => Promise<ConfigView>;
  /** The config on disk replaced the draft (an import into this workspace). */
  reload: () => Promise<void>;
  avail: WizardAvailability | null;
  goTo: (step: WizardStepId) => void;
  /** Leaves the wizard (review step: after finishing). */
  finish: () => void;
  firstRun: boolean;
}

const BODY: Record<WizardStepId, (p: StepProps) => ReactElement> = {
  language: (p) => <LanguageStep {...p} />,
  models: (p) => <ModelsStep {...p} />,
  sdk: (p) => <SdkStep {...p} />,
  projects: (p) => <ProjectsStep {...p} />,
  integrations: (p) => <IntegrationsStep {...p} />,
  docs: (p) => <DocsStep {...p} />,
  cycle: (p) => <CycleStep {...p} />,
  voice: (p) => <VoiceStep {...p} />,
  review: (p) => <ReviewStep {...p} />,
};

/** What blocks leaving a step forward, as an i18n key; null when the step can be saved. */
export function stepProblem(step: WizardStepId, cfg: WorkspaceConfig): string | null {
  if (step === 'models') {
    const ids = new Set(cfg.llm.providers.map((p) => p.id));
    if (!cfg.llm.providers.length) return 'wizard.problem.noProvider';
    for (const r of LLM_ROLES) {
      const rm = cfg.llm.roles[r];
      if (!ids.has(rm.provider) || !/^\S+$/.test(rm.model)) return 'wizard.problem.roleModel';
    }
  }
  if (step === 'projects') {
    const ids = cfg.projects.repos.map((r) => r.id);
    if (ids.some((id) => !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id))) return 'wizard.problem.repoId';
    if (new Set(ids).size !== ids.length) return 'wizard.problem.repoDuplicate';
  }
  if (step === 'integrations') {
    if (cfg.vcs.some((v) => !v.host.trim())) return 'wizard.problem.vcsHost';
  }
  return null;
}

function WebNotice() {
  const t = useT();
  return (
    <div className="page">
      <div className="wrap wz-wrap">
        <section className="panel wz-card" aria-labelledby="wz-web-title">
          <h1 id="wz-web-title" className="wz-title">{t('wizard.web.title')}</h1>
          <p>{t('wizard.web.body')}</p>
          <p className="small muted">{t('wizard.web.secrets')}</p>
        </section>
      </div>
    </div>
  );
}

export function SetupWizard({ firstRun, onClose }: { firstRun: boolean; onClose: () => void }) {
  if (isWeb()) return <WebNotice />;
  return <Wizard firstRun={firstRun} onClose={onClose} />;
}

function Wizard({ firstRun, onClose }: { firstRun: boolean; onClose: () => void }) {
  const t = useT();
  const [view, setView] = useState<ConfigView | null>(null);
  const [cfg, setCfgState] = useState<WorkspaceConfig | null>(null);
  const [avail, setAvail] = useState<WizardAvailability | null>(null);
  const [progress, setProgress] = useState<WizardProgress>(emptyProgress());
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    void (async () => {
      try {
        const v = await wizardApi.config();
        const p = firstRun ? await wizardApi.progress() : emptyProgress();
        if (!firstRun) await wizardApi.clearProgress();
        setView(v);
        setCfgState(v.config);
        setProgress(p);
        setAvail(await wizardApi.availability().catch(() => null));
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, [firstRun]);

  useEffect(() => {
    if (cfg) applyLanguage(cfg.language);
  }, [cfg?.language]);

  // The installer records claudeSdk in the config on its own: the draft adopts it even when the SDK step is not on screen.
  useEffect(() => {
    const onEvent = (e: Event) => {
      if ((e as CustomEvent<SdkEvent>).detail.phase !== 'done') return;
      void wizardApi.config().then((v) => {
        setView(v);
        setCfgState((c) => (c ? { ...c, claudeSdk: v.config.claudeSdk } : c));
      });
    };
    moduleEvents.addEventListener(SDK_EVENT, onEvent);
    return () => moduleEvents.removeEventListener(SDK_EVENT, onEvent);
  }, []);

  const step = progress.step;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const setCfg = useCallback((change: (c: WorkspaceConfig) => WorkspaceConfig) => {
    setProblem(null);
    setCfgState((c) => (c ? change(structuredClone(c)) : c));
  }, []);

  const refreshView = useCallback(async () => {
    const v = await wizardApi.config();
    setView(v);
    return v;
  }, []);

  if (!cfg || !view) {
    return (
      <div className="page">
        <div className="wrap wz-wrap">{error ? <div className="error" role="alert">{error}</div> : <span className="spinner" aria-label={t('wizard.loading')} />}</div>
      </div>
    );
  }

  const steps = visibleSteps(cfg);
  const index = Math.max(0, steps.indexOf(step));
  const current = steps[index];

  const persist = async (next: WizardProgress, config = cfg): Promise<boolean> => {
    try {
      setView(await wizardApi.save(config));
      setProgress(await wizardApi.saveProgress(next));
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };

  const move = async (target: WizardStepId, mark: 'done' | 'skipped' | null) => {
    setError(null);
    const blocked = mark === 'done' ? stepProblem(current, cfg) : null;
    if (blocked) {
      setProblem(blocked);
      return;
    }
    setBusy(true);
    const done = mark === 'done' ? [...new Set([...progress.done, current])] : mark === 'skipped' ? progress.done.filter((s) => s !== current) : progress.done;
    const skipped = mark === 'skipped' ? [...new Set([...progress.skipped, current])] : mark === 'done' ? progress.skipped.filter((s) => s !== current) : progress.skipped;
    await persist({ ...progress, step: target, done, skipped });
    setBusy(false);
  };

  const next = () => void move(steps[Math.min(steps.length - 1, index + 1)], 'done');
  const skip = () => void move(steps[Math.min(steps.length - 1, index + 1)], 'skipped');
  const back = () => void move(steps[Math.max(0, index - 1)], null);
  const jump = (target: WizardStepId) => {
    setRailOpen(false);
    if (target !== current) void move(target, null);
  };

  const complete = async () => {
    setError(null);
    setBusy(true);
    const config = { ...cfg, setupComplete: true };
    const sdk = view.claudeSdk;
    if (sdk.mode === 'bundled' && !config.claudeSdk.installed) config.claudeSdk = { ...config.claudeSdk, installed: true };
    try {
      await wizardApi.save(config);
      await wizardApi.clearProgress();
      applyLanguage(config.language);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const reload = async () => {
    const v = await refreshView();
    setCfgState(v.config);
    if (v.config.setupComplete) {
      await wizardApi.clearProgress();
      onClose();
    }
  };

  const stepProps: StepProps = { cfg, setCfg, view, refreshView, reload, avail, goTo: jump, finish: () => void complete(), firstRun };
  const skippable = SKIPPABLE_STEPS.includes(current);
  const last = index === steps.length - 1;
  const statusOf = (s: WizardStepId) => (progress.skipped.includes(s) ? 'skipped' : progress.done.includes(s) ? 'done' : s === current ? 'current' : 'todo');

  return (
    <div className="page wz-page">
      <div className="wrap wz-wrap">
        <header className="wz-head">
          <div className="row" style={{ gap: 12 }}>
            {!firstRun && (
              <button type="button" className="btn icon-btn" aria-label={t('wizard.exit')} onClick={onClose}><BackIcon /></button>
            )}
            <div>
              <h1 className="wz-title">{t('wizard.title')}</h1>
              <p className="small muted">{firstRun ? t('wizard.subtitle.first') : t('wizard.subtitle.rerun')}</p>
            </div>
          </div>
          <div className="wz-progress-wrap">
            <div className="small wz-progress-text" aria-live="polite">{t('wizard.progress', { n: index + 1, total: steps.length, name: t(`wizard.step.${current}`) })}</div>
            <div className="wz-bar" role="progressbar" aria-label={t('wizard.title')} aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-valuetext={t('wizard.progress', { n: index + 1, total: steps.length, name: t(`wizard.step.${current}`) })}>
              <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
            </div>
            <button type="button" className="btn wz-rail-toggle" aria-expanded={railOpen} aria-controls="wz-rail" onClick={() => setRailOpen(!railOpen)}>{t('wizard.allSteps')}</button>
          </div>
        </header>

        <div className="wz-layout">
          <nav id="wz-rail" className={`wz-rail ${railOpen ? 'open' : ''}`} aria-label={t('wizard.allSteps')}>
            <ol>
              {steps.map((s, i) => {
                const st = statusOf(s);
                return (
                  <li key={s}>
                    <button type="button" className={`wz-step wz-step-${st}`} aria-current={s === current ? 'step' : undefined} onClick={() => jump(s)}>
                      <span className="wz-num" aria-hidden="true">{st === 'done' ? '✓' : i + 1}</span>
                      <span>
                        {t(`wizard.step.${s}`)}
                        {(st === 'done' || st === 'skipped') && <span className="wz-sr"> ({t(`wizard.status.${st}`)})</span>}
                      </span>
                      {st === 'skipped' && <span className="badge badge-quiet" aria-hidden="true">{t('wizard.status.skipped')}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <main className="panel wz-card" aria-labelledby="wz-step-title">
            <h2 id="wz-step-title" className="wz-step-title" tabIndex={-1} ref={heading}>{t(`wizard.step.${current}`)}</h2>
            <p className="muted">{t(`wizard.step.${current}.hint`)}</p>
            {error && <div className="error" role="alert">{error}</div>}
            {problem && <Notice tone="warn" role="alert">{t(problem)}</Notice>}
            {BODY[current](stepProps)}
            <footer className="wz-footer">
              <div className="wz-actions">
                {index > 0 && <button type="button" className="btn" disabled={busy} onClick={back}>{t('wizard.back')}</button>}
              </div>
              <div className="wz-actions">
                {skippable && !last && <button type="button" className="btn" disabled={busy} onClick={skip}>{t('wizard.skip')}</button>}
                {firstRun && index === 0 && <button type="button" className="btn" disabled={busy} onClick={() => void complete()}>{t('wizard.later')}</button>}
                {!last && (
                  <button type="button" className="btn btn-dark" disabled={busy} onClick={next}>
                    {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.next')}
                  </button>
                )}
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
