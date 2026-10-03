import { useEffect, useState } from 'react';
import { LANGUAGES } from '../../../shared/config/types';
import { type ToolSwitch, visibleTools } from '../../../shared/cycles/view';
import { type ModelRole, type Settings, type Theme } from '../../../shared/settings';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { clearSpeechCache, setBargeIn, setSpeechEnabled } from '../audio';
import { autostartApi } from '../autostartApi';
import { useCycle } from '../cycleApi';
import { applyLanguage, applyVoiceMode, intlLocale, tv, useT } from '../i18n';
import { applyTheme } from '../theme';
import { jobs, useJobs } from '../useJobs';
import { FalaCostByModel } from './FalasCusto';
import { VoiceControls } from './VoiceControls';
import { BackIcon } from './icons';
import { ConflictVerifySection } from './ConflictVerifySection';
import { RetentionSection } from './RetentionSection';
import { PushSection } from './PushSection';
import { WebAccessSection } from './WebAccessSection';
import { UpdateSection } from './UpdateSection';
import { ConfigWorkspacesSection } from './ConfigWorkspacesSection';
import { TeamSettings } from './team/TeamSettings';

// The tables hold catalog keys; they are translated at render so the language switches live.
const ROLES: [ModelRole, string, string][] = [
  ['turn', 'ui.settings.role.turn.label', 'ui.settings.role.turn.hint'],
  ['reply', 'ui.settings.role.reply.label', 'ui.settings.role.reply.hint'],
  ['deep', 'ui.settings.role.deep.label', 'ui.settings.role.deep.hint'],
  ['teams', 'ui.settings.role.teams.label', 'ui.settings.role.teams.hint'],
  ['fix', 'ui.settings.role.fix.label', 'ui.settings.role.fix.hint'],
];

// The agent read switch (`glab` in the settings) governs the host's CLI when it has one and the app's own read tool when it does not.
const TOOL_KEYS = (cli: boolean): Record<ToolSwitch, [string, string]> => ({
  files: ['ui.settings.tool.files.label', 'ui.settings.tool.files.hint'],
  skills: ['ui.settings.tool.skills.label', 'ui.settings.tool.skills.hint'],
  gitlabMcp: ['ui.settings.tool.gitlabMcp.label', 'ui.settings.tool.gitlabMcp.hint'],
  glab: cli ? ['ui.settings.tool.vcsCli.label', 'ui.settings.tool.vcsCli.hint'] : ['ui.settings.tool.vcsTool.label', 'ui.settings.tool.vcsTool.hint'],
  subagents: ['ui.settings.tool.subagents.label', 'ui.settings.tool.subagents.hint'],
});

const THEME_LABELS: [Theme, string, string][] = [
  ['system', 'ui.settings.theme.system', 'ui.settings.theme.systemHint'],
  ['light', 'ui.settings.theme.light', 'ui.settings.theme.lightHint'],
  ['dark', 'ui.settings.theme.dark', 'ui.settings.theme.darkHint'],
];

const LANGUAGE_LABELS: Record<(typeof LANGUAGES)[number], string> = { 'pt-BR': 'settings.language.pt-BR', en: 'settings.language.en' };

// Sunday is 0, like schedule.days. Intl gives "dom." / "Sun": capitalized and without the abbreviation dot.
function dayName(day: number): string {
  const name = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(new Date(2024, 0, 7 + day)).replace(/\.$/, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function SettingsScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const host = useCycle()?.host;
  // Until the cycle has loaded only the switches every workspace has are listed.
  const keys = TOOL_KEYS(!!host?.cli);
  const tools = (host ? visibleTools(host) : (['files', 'skills', 'subagents'] as const)).map((key) => [key, ...keys[key]] as const);
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    api.getSettings().then(setS, (e) => setError(errorText(e)));
    autostartApi.get().then(setAutostart, () => setAutostart(false));
  }, []);

  const toggleAutostart = async () => {
    setError(null);
    try {
      setAutostart(await autostartApi.set(!autostart));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const running = useJobs<string>('settings:', {
    done: (text) => setStatus(text),
    failed: (message) => setStatus(t('ui.settings.failed', { message })),
  });
  const checking = running.length > 0;

  if (!s) return <div className="page"><div className="wrap">{error ? <div className="error">{error}</div> : <span className="spinner" />}</div></div>;

  const set = (change: (prev: Settings) => Settings) => {
    setSaved(null);
    setS((prev) => (prev ? change(prev) : prev));
  };

  const save = async () => {
    setError(null);
    try {
      const saved = await api.saveSettings(s);
      setS(saved);
      applyVoiceMode(saved.voice.enabled);
      setSpeechEnabled(saved.voice.speak);
      setBargeIn(saved.voice.bargeIn);
      clearSpeechCache();
      applyTheme(saved.appearance.theme);
      applyLanguage(saved.language);
      setSaved(t('ui.settings.savedAt', { time: new Date().toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const check = () => {
    setStatus(null);
    jobs.launch('settings:status', { label: t('ui.settings.statusJob.label'), busy: t('ui.settings.statusJob.busy'), screen: { name: 'settings' } }, () => api.checkStatus());
  };

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 980, gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.settings.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('settings.title')}</h1>
          </div>
          <div className="row">
            {saved && <span className="small" style={{ color: 'var(--teal-ink)' }}>{saved}</span>}
            <button type="button" className="btn btn-dark" onClick={() => void save()}>{t('ui.settings.save')}</button>
          </div>
        </header>
        {error && <div className="error">{error}</div>}

        <ConfigWorkspacesSection go={go} />
        <TeamSettings />

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.models.title')}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.models.hint')}</p>
          </div>
          {ROLES.map(([role, labelKey, hintKey]) => {
            const label = t(labelKey);
            const custom = !s.modelOptions.includes(s.models[role]);
            return (
              <div key={role} className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div className="small muted">{t(hintKey)}</div>
                  {role === 'turn' && <FalaCostByModel current={s.models.turn} />}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <select
                    className="text-input"
                    aria-label={t('ui.settings.models.modelAria', { label })}
                    value={custom ? '__custom' : s.models[role]}
                    onChange={(e) => set((p) => ({ ...p, models: { ...p.models, [role]: e.target.value === '__custom' ? '' : e.target.value } }))}
                  >
                    {s.modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    <option value="__custom">{t('ui.settings.models.otherOption')}</option>
                  </select>
                  {custom && (
                    <input
                      className="text-input mono"
                      aria-label={t('ui.settings.models.otherAria', { label })}
                      placeholder={t('ui.settings.models.otherPlaceholder')}
                      value={s.models[role]}
                      onChange={(e) => set((p) => ({ ...p, models: { ...p.models, [role]: e.target.value.trim() } }))}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.tools.title')}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              {t('ui.settings.tools.hint')}
            </p>
          </div>
          {tools.map(([key, labelKey, hintKey]) => (
            <label key={key} className="check-row">
              <input type="checkbox" checked={s.tools[key]} onChange={() => set((p) => ({ ...p, tools: { ...p.tools, [key]: !p.tools[key] } }))} />
              <span>
                <span style={{ fontWeight: 600, display: 'block' }}>{t(labelKey)}</span>
                <span className="small muted">{t(hintKey)}</span>
              </span>
            </label>
          ))}
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.voice.title')}</h2>
          </div>
          <VoiceControls s={s} set={set} />
          {s.voice.enabled && (
            <>
          <div className="settings-row">
            <label htmlFor="engine" style={{ fontWeight: 600 }}>{t('ui.settings.voice.engineLabel')}</label>
            <div>
              <select id="engine" className="text-input" value={s.voice.engine} onChange={(e) => set((p) => ({ ...p, voice: { ...p.voice, engine: e.target.value as 'edge' | 'kokoro' } }))}>
                <option value="edge">{t('ui.settings.voice.engineEdge')}</option>
                <option value="kokoro">{t('ui.settings.voice.engineKokoro')}</option>
              </select>
              <p className="small muted" style={{ marginTop: 6 }}>
                {s.voice.engine === 'kokoro'
                  ? t('ui.settings.voice.engineHintKokoro')
                  : t('ui.settings.voice.engineHintEdge')}
              </p>
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={s.voice.speak} onChange={() => set((p) => ({ ...p, voice: { ...p.voice, speak: !p.voice.speak } }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.settings.voice.speakLabel')}</span>
              <span className="small muted">{t('ui.settings.voice.speakHint')}</span>
            </span>
          </label>
          <div className="settings-row">
            <span style={{ fontWeight: 600 }}>{t('ui.settings.voice.glossaryLabel')}</span>
            <div>
              <button type="button" className="btn" onClick={() => go({ name: 'glossario' })}>{t('ui.settings.voice.glossaryButton')}</button>
              <p className="small muted" style={{ marginTop: 6 }}>{t('ui.settings.voice.glossaryHint')}</p>
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={s.voice.prosody} onChange={() => set((p) => ({ ...p, voice: { ...p.voice, prosody: !p.voice.prosody } }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.settings.voice.prosodyLabel')}</span>
              <span className="small muted">{s.voice.engine === 'kokoro' ? t('ui.settings.voice.prosodyHintKokoro') : t('ui.settings.voice.prosodyHint')}</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.voice.autoStop} onChange={() => set((p) => ({ ...p, voice: { ...p.voice, autoStop: !p.voice.autoStop } }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.settings.voice.autoStopLabel')}</span>
              <span className="small muted">{t('ui.settings.voice.autoStopHint')}</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.voice.bargeIn} onChange={() => set((p) => ({ ...p, voice: { ...p.voice, bargeIn: !p.voice.bargeIn } }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.settings.voice.bargeInLabel')}</span>
              <span className="small muted">{t('ui.settings.voice.bargeInHint')}</span>
            </span>
          </label>
          <div className="settings-row">
            <label htmlFor="silence" style={{ fontWeight: 600 }}>{t('ui.settings.voice.silenceLabel')}</label>
            <div className="row" style={{ gap: 8 }}>
              <input id="silence" type="number" min={500} max={5000} step={100} className="text-input" style={{ maxWidth: 110 }} disabled={!s.voice.autoStop} value={s.voice.silenceMs} onChange={(e) => set((p) => ({ ...p, voice: { ...p.voice, silenceMs: Number(e.target.value) } }))} />
              <span className="small muted">{t('ui.settings.voice.silenceUnit')}</span>
            </div>
          </div>
            </>
          )}
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.schedule.title')}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.schedule.hint')}</p>
          </div>
          <div className="settings-row">
            <div style={{ fontWeight: 600 }}>{t('ui.settings.schedule.days')}</div>
            <div className="row" style={{ gap: 6 }}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                const d = dayName(i);
                const on = s.schedule.days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`filter ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => set((p) => ({ ...p, schedule: { ...p.schedule, days: on ? p.schedule.days.filter((x) => x !== i) : [...p.schedule.days, i].sort() } }))}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="settings-row">
            <label htmlFor="pre" style={{ fontWeight: 600 }}>{t('ui.settings.schedule.preDaily')}</label>
            <input id="pre" type="time" className="text-input" style={{ maxWidth: 140 }} value={s.schedule.preDaily} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, preDaily: e.target.value } }))} />
          </div>
          <div className="settings-row">
            <div style={{ fontWeight: 600 }}>{t('ui.settings.schedule.statusLabel')}</div>
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted">{t('ui.settings.schedule.every')}</span>
              <input type="number" min={5} max={240} className="text-input" aria-label={t('ui.settings.schedule.intervalAria')} style={{ maxWidth: 90 }} value={s.schedule.statusEveryMin} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, statusEveryMin: Number(e.target.value) } }))} />
              <span className="small muted">{t('ui.settings.schedule.minFrom')}</span>
              <input type="time" className="text-input" aria-label={t('ui.settings.schedule.fromAria')} style={{ maxWidth: 130 }} value={s.schedule.from} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, from: e.target.value } }))} />
              <span className="small muted">{t('ui.settings.schedule.to')}</span>
              <input type="time" className="text-input" aria-label={t('ui.settings.schedule.toAria')} style={{ maxWidth: 130 }} value={s.schedule.to} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, to: e.target.value } }))} />
            </div>
          </div>
          <div className="settings-row">
            <div style={{ fontWeight: 600 }}>{t('ui.settings.schedule.retroLabel')}</div>
            <div className="row" style={{ gap: 8 }}>
              <select className="text-input" aria-label={t('ui.settings.schedule.retroDayAria')} style={{ maxWidth: 140 }} value={s.schedule.retroDay} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, retroDay: Number(e.target.value) } }))}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => <option key={i} value={i}>{dayName(i)}</option>)}
              </select>
              <input type="time" className="text-input" aria-label={t('ui.settings.schedule.retroTimeAria')} style={{ maxWidth: 130 }} value={s.schedule.retroTime} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, retroTime: e.target.value } }))} />
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={s.notifications} onChange={() => set((p) => ({ ...p, notifications: !p.notifications }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.settings.schedule.notificationsLabel')}</span>
              <span className="small muted">{tv('settings.notifications.hint')}</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.closeToTray} onChange={() => set((p) => ({ ...p, closeToTray: !p.closeToTray }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.settings.schedule.trayLabel')}</span>
              <span className="small muted">{t('ui.settings.schedule.trayHint')}</span>
            </span>
          </label>
          <div className="row">
            <button type="button" className="btn" disabled={checking} onClick={() => check()}>
              {checking ? <span className="spinner" /> : null} {t('ui.settings.schedule.checkNow')}
            </button>
            {status && <span className="small muted" style={{ whiteSpace: 'pre-line' }}>{status}</span>}
          </div>
        </section>

        <RetentionSection value={s.retention} onChange={(retention) => set((p) => ({ ...p, retention }))} />
        <ConflictVerifySection />
        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.language.title')}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>{t('settings.language.hint')}</p>
          </div>
          <div role="group" aria-label={t('settings.language.title')} className="row" style={{ gap: 8 }}>
            {LANGUAGES.map((lang) => (
              <button key={lang} type="button" aria-pressed={s.language === lang} className={`filter ${s.language === lang ? 'on' : ''}`} onClick={() => set((p) => ({ ...p, language: lang }))}>
                {t(LANGUAGE_LABELS[lang])}
              </button>
            ))}
          </div>
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.appearance.title')}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>{tv('settings.appearance.hint')}</p>
          </div>
          <div role="group" aria-label={t('ui.settings.theme.aria')} className="row" style={{ gap: 8 }}>
            {THEME_LABELS.map(([value, labelKey, hintKey]) => (
              <button
                key={value}
                type="button"
                aria-pressed={s.appearance.theme === value}
                title={t(hintKey)}
                className={`filter ${s.appearance.theme === value ? 'on' : ''}`}
                onClick={() => set((p) => ({ ...p, appearance: { ...p.appearance, theme: value } }))}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
          <p className="small muted">{t(THEME_LABELS.find(([value]) => value === s.appearance.theme)?.[2] ?? 'ui.settings.theme.systemHint')}</p>
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.start.title')}</h2>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={autostart === true} disabled={autostart === null} onChange={() => void toggleAutostart()} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.settings.start.autostartLabel')}</span>
              <span className="small muted">{t('ui.settings.start.autostartHint')}</span>
            </span>
          </label>
        </section>

        <UpdateSection />
        <PushSection />
        <WebAccessSection />
      </div>
    </div>
  );
}
