import { useCallback, useEffect, useState } from 'react';
import type { VoiceEngine } from '../../../shared/config/types';
import type { Settings } from '../../../shared/settings';
import { STT_MODELS, STT_MODEL_BYTES, type SttModel, type VoiceCheck, type VoiceInstallResult, type VoiceStatus, type VoiceTestResult } from '../../../shared/voiceSetup';
import { api, errorText } from '../api';
import { applyVoiceMode, useT } from '../i18n';
import { isWeb } from '../platform';
import { useVoiceProgress, voiceApi } from '../voiceApi';
import '../voice.css';

const size = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
const isModel = (v: string): v is SttModel => (STT_MODELS as readonly string[]).includes(v);

type Fail = Extract<VoiceInstallResult, { ok: false; cancelled: false }>;

// Settings → Voz: the switch, the state of the dependencies, the install (model and engine choice, progress, cancel), the test and the removal.
// The wizard calls the same voice:* channels (src/renderer/src/voiceApi.ts).
export function VoiceControls({ s, set }: { s: Settings; set: (change: (prev: Settings) => Settings) => void }) {
  const t = useT();
  const web = isWeb();
  const progress = useVoiceProgress();
  const [check, setCheck] = useState<VoiceCheck | null>(null);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [panel, setPanel] = useState(false);
  const [model, setModel] = useState<SttModel>(isModel(s.voice.sttModel) ? s.voice.sttModel : 'small');
  const [engine, setEngine] = useState<VoiceEngine>(s.voice.engine);
  const [ack, setAck] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [fail, setFail] = useState<Fail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<VoiceTestResult | null>(null);
  const [mic, setMic] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removed, setRemoved] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (web) return;
    try {
      const [c, st] = await Promise.all([voiceApi.check(model), voiceApi.status()]);
      setCheck(c);
      setStatus(st);
    } catch (e) {
      setError(errorText(e));
    }
  }, [model, web]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // What main holds (the switch, the install and the chosen model are never part of a Settings save) comes back into the form.
  const pull = async () => {
    const saved = await api.getSettings();
    set((p) => ({ ...p, voice: { ...p.voice, enabled: saved.voice.enabled, depsInstalled: saved.voice.depsInstalled, sttModel: saved.voice.sttModel, engine: saved.voice.engine } }));
    applyVoiceMode(saved.voice.enabled);
    await refresh();
  };

  const toggle = async () => {
    setError(null);
    setRemoved(null);
    try {
      if (s.voice.enabled) {
        await voiceApi.enable(false);
        await pull();
        return;
      }
      const r = await voiceApi.enable(true);
      if (r.needsInstall) {
        setPanel(true);
        await refresh();
        return;
      }
      await pull();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const install = async () => {
    setInstalling(true);
    setFail(null);
    setError(null);
    try {
      const r = await voiceApi.install({ sttModel: model, engine, acknowledgeEdge: ack, enable: true });
      if (r.ok) {
        setPanel(false);
        await pull();
      } else if (!r.cancelled) setFail(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setInstalling(false);
      await refresh();
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      setTest(await voiceApi.test());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTesting(false);
    }
  };

  const checkMic = async () => {
    setMic(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setMic(t('voice.mic.ok'));
    } catch (e) {
      setMic(t('voice.mic.fail', { error: errorText(e) }));
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setError(null);
    try {
      const r = await voiceApi.uninstall();
      setRemoved(t('voice.uninstall.done', { size: size(r.freedBytes) }));
      setTest(null);
      await pull();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const kokoro = check?.engines.find((e) => e.id === 'kokoro');
  const edgeNeedsAck = engine === 'edge' && !ack;
  const canInstall = !!check && check.canInstall && !installing && !edgeNeedsAck && (engine !== 'kokoro' || !!kokoro?.available);
  const showProgress = installing || (progress && (progress.phase === 'failed' || progress.phase === 'cancelled') && panel);
  const deps = check?.installed.kind ? t(`voice.status.deps.${check.installed.kind}`) : t('voice.status.deps.none');
  const downloaded = check ? STT_MODELS.filter((m) => check.installed.models[m]) : [];
  const engineState = !status?.running ? t('voice.status.engine.stopped') : status.ready ? t('voice.status.engine.running') : t('voice.status.engine.loading');

  return (
    <>
      <p className="small muted">{t('voice.section.hint')}</p>
      <label className="check-row">
        <input type="checkbox" role="switch" checked={s.voice.enabled} disabled={web || installing} onChange={() => void toggle()} />
        <span>
          <span style={{ fontWeight: 600, display: 'block' }}>{t('voice.enable.label')}</span>
          <span className="small muted">{s.voice.enabled ? t('voice.enable.on') : panel ? t('voice.enable.needsInstall') : t('voice.enable.off')}</span>
        </span>
      </label>
      {web && <p className="small muted">{t('voice.web.hint')}</p>}
      {error && <div className="error">{error}</div>}

      {!web && check && (
        <>
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>{t('voice.status.title')}</h3>
          <dl className="voice-facts">
            <dt>{t('voice.status.deps')}</dt>
            <dd>{deps}</dd>
            <dt>{t('voice.status.python')}</dt>
            <dd>{check.python.found ? t('voice.status.python.found', { version: check.python.version ?? '?' }) : t('voice.status.python.none')}</dd>
            <dt>{t('voice.status.uv')}</dt>
            <dd>{check.uv.found ? t('voice.status.uv.found') : check.uv.installable ? t('voice.status.uv.installable') : t('voice.status.uv.none')}</dd>
            <dt>{t('voice.status.models')}</dt>
            <dd>{downloaded.length ? downloaded.join(', ') : t('voice.status.models.none')}</dd>
            <dt>{t('voice.status.disk')}</dt>
            <dd>
              {check.disk.freeBytes === null
                ? t('voice.status.disk.unknown', { needed: size(check.disk.neededBytes) })
                : t('voice.status.disk.value', { free: size(check.disk.freeBytes), needed: size(check.disk.neededBytes) })}
            </dd>
            <dt>{t('voice.status.engine')}</dt>
            <dd>{engineState}</dd>
          </dl>
          {check.problems.map((p) => (
            <div key={p} className="error">{t(`voice.problem.${p}`)}</div>
          ))}

          {!panel && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => setPanel(true)}>
                {check.installed.venv ? t('voice.install.change') : t('voice.install.button')}
              </button>
            </div>
          )}

          {panel && (
            <div className="voice-install" role="group" aria-label={t('voice.install.title')}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>{t('voice.install.title')}</h3>
                <p className="small muted" style={{ marginTop: 4 }}>{t('voice.install.hint')}</p>
              </div>

              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} disabled={installing}>
                <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t('voice.install.model.title')}</legend>
                {STT_MODELS.map((m) => (
                  <label key={m} className="voice-choice">
                    <input type="radio" name="stt-model" checked={model === m} onChange={() => setModel(m)} />
                    <span>
                      <span style={{ fontWeight: 600, display: 'block' }}>{m}</span>
                      <span className="small muted">{t(`voice.model.${m}`, { size: size(STT_MODEL_BYTES[m]) })}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} disabled={installing}>
                <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t('voice.install.engine.title')}</legend>
                <label className="voice-choice">
                  <input type="radio" name="tts-engine" checked={engine === 'edge'} onChange={() => setEngine('edge')} />
                  <span>
                    <span style={{ fontWeight: 600, display: 'block' }}>{t('voice.engine.edge')}</span>
                    <span className="small muted">{t('voice.engine.edge.warn')}</span>
                  </span>
                </label>
                <label className="voice-choice" aria-disabled={!kokoro?.available}>
                  <input type="radio" name="tts-engine" checked={engine === 'kokoro'} disabled={!kokoro?.available} onChange={() => setEngine('kokoro')} />
                  <span>
                    <span style={{ fontWeight: 600, display: 'block' }}>{t('voice.engine.kokoro')}</span>
                    <span className="small muted">
                      {kokoro?.available ? t('voice.engine.kokoro.ok', { dir: kokoro.modelDir ?? '' }) : t('voice.engine.kokoro.missing', { dir: kokoro?.expectedDir ?? '' })}
                    </span>
                  </span>
                </label>
                {engine === 'edge' && (
                  <label className="check-row">
                    <input type="checkbox" checked={ack} onChange={() => setAck((v) => !v)} />
                    <span className="small">{t('voice.engine.edge.ack')}</span>
                  </label>
                )}
              </fieldset>

              {showProgress && progress && (
                <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{t(`voice.phase.${progress.phase}`)}</span>
                  {progress.percent === null ? <progress className="voice-progress" aria-label={t('voice.install.title')} /> : <progress className="voice-progress" max={100} value={progress.percent} aria-label={t('voice.install.title')} />}
                  {progress.bytes && progress.bytes.total !== null && <span className="small muted">{size(progress.bytes.done)} / {size(progress.bytes.total)}</span>}
                  {progress.detail && <span className="small faint mono voice-detail">{progress.detail}</span>}
                </div>
              )}
              {fail && <div className="error">{t(`voice.fail.${fail.code}`)}</div>}

              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-dark" disabled={!canInstall} onClick={() => void install()}>
                  {installing ? <span className="spinner" /> : null} {t('voice.install.button')}
                </button>
                {installing ? (
                  <button type="button" className="btn" onClick={() => void voiceApi.cancelInstall()}>{t('voice.install.cancel')}</button>
                ) : (
                  <button type="button" className="btn" onClick={() => setPanel(false)}>{t('voice.install.close')}</button>
                )}
              </div>
            </div>
          )}

          {s.voice.enabled && (
            <>
              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>{t('voice.test.title')}</div>
                  <div className="small muted">{t('voice.test.hint')}{s.voice.engine === 'edge' ? ` ${t('voice.test.edgeNote')}` : ''}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" disabled={testing} onClick={() => void runTest()}>
                      {testing ? <span className="spinner" /> : null} {t('voice.test.button')}
                    </button>
                    {testing && <span className="small muted">{t('voice.test.running')}</span>}
                  </div>
                  {test && (
                    <div className={test.ok ? 'small' : 'error'} role="status">
                      {test.ok ? t('voice.test.ok', { heard: test.heard, speak: test.speakMs, listen: test.listenMs }) : t('voice.test.fail', { heard: test.heard, expected: test.expected, error: test.error ?? '' })}
                    </div>
                  )}
                </div>
              </div>
              <div className="settings-row">
                <div style={{ fontWeight: 600 }}>{t('voice.mic.title')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div><button type="button" className="btn" onClick={() => void checkMic()}>{t('voice.mic.button')}</button></div>
                  {mic && <div className="small" role="status">{mic}</div>}
                </div>
              </div>
            </>
          )}

          {(check.installed.removableBytes > 0 || removed) && (
            <div className="settings-row">
              <div>
                <div style={{ fontWeight: 600 }}>{t('voice.uninstall.title')}</div>
                <div className="small muted">{t('voice.uninstall.hint', { size: size(check.installed.removableBytes) })}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {confirmRemove ? (
                  <>
                    <button type="button" className="btn btn-red" onClick={() => void remove()}>{t('voice.uninstall.yes')}</button>
                    <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>{t('voice.install.cancel')}</button>
                    <span className="small muted">{t('voice.uninstall.confirm')}</span>
                  </>
                ) : (
                  <button type="button" className="btn" disabled={installing} onClick={() => setConfirmRemove(true)}>{t('voice.uninstall.button')}</button>
                )}
                {removed && <span className="small" role="status">{removed}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
