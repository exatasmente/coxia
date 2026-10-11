import { useEffect, useState } from 'react';
import { ASSIST_LIMITS } from '../../../../shared/agentAssist';
import type { AgentDef, WorkspaceConfig } from '../../../../shared/config/types';
import { personaDraftOf, personaOf } from '../../../../shared/config/team';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { forgetNow, reloadThreads } from '../cycle/forumApi';
import { type AgentDraft, draftOf } from '../team/agentEdit';
import { ModelFields } from '../team/TeamSection';
import { useConfigView } from '../team/teamApi';
import { agentName } from '../team/text';
import { Confirm, Labeled } from '../team/ui';
import { PersonaWizard } from './PersonaWizard';
import { StopControl } from './StopControl';
import { usePersonaState } from '../../personaStopApi';
import { personaApi } from './personaApi';
import '../team/team.css';

// Settings › Persona: make the persona with the wizard, or edit it (name, the sentence, its instructions, its model), adjust it with the AI, clear its conversation or delete
// it. It works the same in the window and in a paired browser, which makes, edits, tests, clears and deletes the persona exactly as the computer does. The persona is not in
// the Team list: it takes no part in the cycle.

type Asking = 'clear' | 'delete' | null;

function Editor({ persona, config, onAdjust, onChat, onChanged }: { persona: AgentDef; config: WorkspaceConfig; onAdjust: () => void; onChat: () => void; onChanged: () => void }) {
  const t = useT();
  const [form, setForm] = useState<AgentDraft>(() => draftOf(persona));
  const [busy, setBusy] = useState<'save' | 'clear' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState<Asking>(null);
  // What the persona is on disk decides what the form shows: a change made elsewhere (another device, the wizard) starts the form again.
  const signature = JSON.stringify([persona.name, persona.job, persona.instructions, persona.model, persona.poolMode ?? null]);
  useEffect(() => {
    setForm(draftOf(persona));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature stands for the persona's fields
  }, [signature]);

  const set = (patch: Partial<AgentDraft>): void => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  const run = async (what: 'save' | 'clear' | 'delete'): Promise<void> => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'save') {
        await personaApi.save({ name: form.name, job: form.job, instructions: form.instructions, model: form.model, poolMode: form.poolMode });
        setSaved(true);
      } else if (what === 'clear') {
        await personaApi.clear();
      } else {
        await personaApi.delete();
      }
      setAsking(null);
      forgetNow();
      reloadThreads();
      onChanged();
    } catch (e) {
      setError(errorText(e));
      setAsking(null);
    }
    setBusy(null);
  };

  const stopped = usePersonaState().stopped;

  return (
    <div className="wz-stack">
      <div className="wz-actions" role="status">
        <p className="small muted">{t(stopped ? 'ui.persona.section.state.stopped' : 'ui.persona.section.state.running')}</p>
        <StopControl />
      </div>
      <Labeled label={t('ui.persona.f.name')}>
        {(id) => <input id={id} className="text-input" maxLength={ASSIST_LIMITS.name} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
      </Labeled>
      <Labeled label={t('ui.persona.f.job')} hint={t('ui.persona.f.jobHint')}>
        {(id) => <textarea id={id} className="text-input" rows={3} maxLength={ASSIST_LIMITS.job} value={form.job} onChange={(e) => set({ job: e.target.value })} />}
      </Labeled>
      <Labeled label={t('ui.persona.f.instructions')} hint={t('ui.persona.f.instructionsHint')}>
        {(id) => <textarea id={id} className="text-input mono" rows={12} maxLength={ASSIST_LIMITS.instructions} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} />}
      </Labeled>
      <p className="small muted" role="note">{t('ui.persona.section.readNote')}</p>
      <ModelFields config={config} draft={form} set={set} />
      {error && <div className="error" role="alert">{error}</div>}
      <div className="wz-actions">
        <button type="button" className="btn btn-dark" disabled={busy !== null || !form.name.trim()} onClick={() => void run('save')}>
          {busy === 'save' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.persona.section.save')}
        </button>
        {saved && <span className="small" role="status" style={{ color: 'var(--teal-ink)' }}>{t('ui.persona.section.saved')}</span>}
        <button type="button" className="btn" disabled={busy !== null} onClick={onAdjust}>{t('ui.team.assist.adjust')}</button>
        <button type="button" className="btn" onClick={onChat}>{t('ui.persona.section.openChat')}</button>
      </div>
      <div className="wz-actions">
        <button type="button" className="btn tm-danger" disabled={busy !== null} onClick={() => setAsking('clear')}>{t('ui.persona.section.clear')}</button>
        <button type="button" className="btn tm-danger" disabled={busy !== null} onClick={() => setAsking('delete')}>{t('ui.persona.section.delete')}</button>
      </div>
      {asking === 'clear' && (
        <Confirm danger confirmLabel={t('ui.persona.section.clear.confirm')} onConfirm={() => void run('clear')} onCancel={() => setAsking(null)}>
          <strong>{t('ui.persona.section.clear.title')}</strong>
          <p>{t('ui.persona.section.clear.body')}</p>
        </Confirm>
      )}
      {asking === 'delete' && (
        <Confirm danger confirmLabel={t('ui.persona.section.delete.confirm')} onConfirm={() => void run('delete')} onCancel={() => setAsking(null)}>
          <strong>{t('ui.persona.section.delete.title')}</strong>
          <p>{t('ui.persona.section.delete.body')}</p>
        </Confirm>
      )}
    </div>
  );
}

export function PersonaSection({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const { view, error, reload } = useConfigView();
  const [wizard, setWizard] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const config = view?.config;
  const persona = config ? personaOf(config.agents.team) : null;
  // A draft left by a closed app, with no wizard open on it: it is shown to be discarded, never listed with the team.
  const leftover = config && !wizard ? personaDraftOf(config.agents.team) : null;

  const discard = async (id: string): Promise<void> => {
    setProblem(null);
    try {
      await personaApi.discard(id);
    } catch (e) {
      setProblem(errorText(e));
    }
    setDiscarding(false);
    forgetNow();
    reloadThreads();
    reload();
  };

  return (
    <section className="wz-stack tm-root" aria-labelledby="persona-title">
      <h2 id="persona-title" className="wz-section-title">{t('ui.persona.section.title')}</h2>
      <p className="small muted">{t('ui.persona.section.intro')}</p>
      {error && <div className="error" role="alert">{error}</div>}
      {problem && <div className="error" role="alert">{problem}</div>}
      {!config && !error && <span className="spinner" aria-label={t('ui.persona.section.loading')} />}
      {config && !persona && (
        <div className="panel" style={{ padding: 16, gap: 10 }}>
          <p>{t('ui.persona.section.none')}</p>
          <div className="wz-actions">
            <button type="button" className="btn btn-dark" disabled={wizard} onClick={() => setWizard(true)}>{t('ui.persona.section.make')}</button>
          </div>
        </div>
      )}
      {config && persona && (
        <Editor persona={persona} config={config} onAdjust={() => setWizard(true)} onChat={() => go({ name: 'chat' })} onChanged={reload} />
      )}
      {leftover && (
        <div className="panel" style={{ padding: 16, gap: 10 }}>
          <p className="small muted">{t('ui.persona.section.draft')}</p>
          <div className="wz-actions">
            <button type="button" className="btn tm-danger" disabled={discarding} aria-label={t('ui.team.draft.discardAria', { name: agentName(leftover) })} onClick={() => setDiscarding(true)}>{t('ui.team.draft.discard')}</button>
          </div>
          {discarding && (
            <Confirm danger confirmLabel={t('ui.team.draft.discard.confirm')} onConfirm={() => void discard(leftover.id)} onCancel={() => setDiscarding(false)}>
              <strong>{t('ui.persona.section.draft.title')}</strong>
              <p>{t('ui.persona.section.draft.body')}</p>
            </Confirm>
          )}
        </div>
      )}
      {wizard && config && (
        <PersonaWizard
          presentation="panel"
          persona={persona}
          onDone={() => {
            setWizard(false);
            reload();
            // Making the first persona ends in its chat; adjusting one only saves it.
            if (!persona) go({ name: 'chat' });
          }}
          onClose={(why) => {
            setWizard(false);
            setProblem(why ?? null);
            reload();
          }}
        />
      )}
    </section>
  );
}
