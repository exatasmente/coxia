import { useEffect, useState } from 'react';
import { VOICE_ENGINES } from '../../../../shared/config/types';
import type { VoiceAction, VoiceRunResult } from '../../../../shared/wizard';
import { errorText, moduleEvents } from '../../api';
import { useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { Notice } from '../ui';
import { wizardApi } from '../wizardApi';

const STT_MODELS = ['tiny', 'base', 'small', 'medium'];
// The names the voice setup API may use for its progress events (it is built separately).
const PROGRESS_EVENTS = ['voice-setup', 'voice:progress', 'voice-install'];

export function VoiceStep({ cfg, setCfg, avail }: StepProps) {
  const t = useT();
  const [running, setRunning] = useState<VoiceAction | null>(null);
  const [results, setResults] = useState<Partial<Record<VoiceAction, VoiceRunResult>>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      const text = typeof d === 'string' ? d : typeof d === 'object' && d !== null ? [(d as Record<string, unknown>).message, (d as Record<string, unknown>).line, (d as Record<string, unknown>).text, (d as Record<string, unknown>).phase].find((x) => typeof x === 'string') : null;
      if (typeof text === 'string') setProgress(text.slice(0, 200));
    };
    for (const name of PROGRESS_EVENTS) moduleEvents.addEventListener(name, on);
    return () => {
      for (const name of PROGRESS_EVENTS) moduleEvents.removeEventListener(name, on);
    };
  }, []);

  const have: Record<VoiceAction, boolean> = { check: !!avail?.voiceCheck, install: !!avail?.voiceInstall, test: !!avail?.voiceTest };

  const run = async (action: VoiceAction) => {
    setError(null);
    setRunning(action);
    setProgress(null);
    try {
      const r = await wizardApi.voice(action, { engine: cfg.voice.engine, sttModel: cfg.voice.sttModel });
      setResults((all) => ({ ...all, [action]: r }));
      if (action === 'install' && r.ok) setCfg((c) => ({ ...c, voice: { ...c.voice, depsInstalled: true } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="wz-stack">
      <div role="radiogroup" aria-label={t('wizard.step.voice')} className="wz-cards">
        {[true, false].map((on) => (
          <label key={String(on)} className={`wz-card-item wz-choice ${cfg.voice.enabled === on ? 'wz-on' : ''}`}>
            <input type="radio" name="voice-enabled" checked={cfg.voice.enabled === on} onChange={() => setCfg((c) => ({ ...c, voice: { ...c.voice, enabled: on } }))} />
            <span>
              <span className="wz-card-title">{t(on ? 'wizard.voice.on' : 'wizard.voice.off')}</span>
              <span className="small muted wz-block">{t(on ? 'wizard.voice.onHint' : 'wizard.voice.offHint')}</span>
            </span>
          </label>
        ))}
      </div>

      {cfg.voice.enabled && (
        <>
          <section className="wz-stack" aria-labelledby="wz-engine">
            <h3 id="wz-engine" className="wz-sub">{t('wizard.voice.engine')}</h3>
            <div role="radiogroup" aria-labelledby="wz-engine" className="wz-cards">
              {VOICE_ENGINES.map((id) => (
                <label key={id} className={`wz-card-item wz-choice ${cfg.voice.engine === id ? 'wz-on' : ''}`}>
                  <input type="radio" name="voice-engine" checked={cfg.voice.engine === id} onChange={() => setCfg((c) => ({ ...c, voice: { ...c.voice, engine: id } }))} />
                  <span>
                    <span className="wz-card-title">{t(`wizard.voice.engine.${id}`)}</span>
                    <span className="small muted wz-block">{t(`wizard.voice.engine.${id}.hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
            {cfg.voice.engine === 'edge' && <Notice tone="warn">{t('wizard.voice.edgePrivacy')}</Notice>}
            {cfg.voice.engine === 'kokoro' && <Notice tone="ok">{t('wizard.voice.kokoroPrivacy')}</Notice>}
          </section>

          <div className="wz-field">
            <label className="wz-label" htmlFor="wz-stt">{t('wizard.voice.stt')}</label>
            <select id="wz-stt" className="text-input" style={{ maxWidth: 240 }} value={cfg.voice.sttModel} onChange={(e) => setCfg((c) => ({ ...c, voice: { ...c.voice, sttModel: e.target.value } }))}>
              {[...new Set([...STT_MODELS, cfg.voice.sttModel])].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="small muted">{t('wizard.voice.sttHint')}</div>
          </div>

          <section className="wz-stack" aria-labelledby="wz-setup">
            <h3 id="wz-setup" className="wz-sub">{t('wizard.voice.setup')}</h3>
            {cfg.voice.depsInstalled && <Notice tone="ok" role="status">{t('wizard.voice.installed')}</Notice>}
            {!have.install && <Notice tone="info">{t('wizard.voice.soon')} <span className="badge badge-quiet">{t('wizard.soon')}</span></Notice>}
            <div className="wz-actions">
              {(['check', 'install', 'test'] as VoiceAction[]).map((a) => (
                <button key={a} type="button" className={`btn ${a === 'install' ? 'btn-dark' : ''}`} disabled={!have[a] || running !== null} onClick={() => void run(a)}>
                  {running === a ? <span className="spinner" aria-hidden="true" /> : null} {t(`wizard.voice.${a}`)}
                  {!have[a] && <span className="badge badge-quiet">{t('wizard.soon')}</span>}
                </button>
              ))}
            </div>
            {running && <p className="small muted" role="status" aria-live="polite">{progress ?? t('wizard.voice.working')}</p>}
            {(['check', 'install', 'test'] as VoiceAction[]).map((a) => {
              const r = results[a];
              return r ? <Notice key={a} tone={r.ok ? 'ok' : 'error'} role="status"><strong>{t(`wizard.voice.${a}`)}:</strong> {r.message || t(r.ok ? 'wizard.voice.resultOk' : 'wizard.voice.resultFail')}</Notice> : null;
            })}
            {error && <div className="error" role="alert">{error}</div>}
            <p className="small muted">{t('wizard.voice.lazy')}</p>
          </section>
        </>
      )}
    </div>
  );
}
