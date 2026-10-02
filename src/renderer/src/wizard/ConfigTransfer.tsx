import { useEffect, useMemo, useState } from 'react';
import type { ImportPreview, ImportResult, ImportTarget } from '../../../shared/configTransfer';
import type { SecretInput, SecretsStorageStatus } from '../../../shared/secrets';
import { type SecretDraft, emptySecretDraft, secretInputFrom } from '../../../shared/wizard';
import type { WorkspaceInfo } from '../../../shared/workspaces';
import { errorText } from '../api';
import { useT } from '../i18n';
import { workspaceApi } from '../workspaceApi';
import { Field, Notice, SecretFields } from './ui';
import { wizardApi } from './wizardApi';

const short = (v: unknown): string => {
  const s = v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
};

/** "Exportar configuração": the file carries the configuration only, never history and never a secret value. */
export function ConfigExport() {
  const t = useT();
  const [result, setResult] = useState<{ path: string | null; secrets: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await wizardApi.exportConfig();
      setResult({ path: r.path, secrets: r.requiredSecrets.map((s) => s.ref) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wz-stack">
      <p className="small muted">{t('wizard.export.hint')}</p>
      <div className="wz-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.export.button')}
        </button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {result?.path && (
        <Notice tone="ok" role="status">
          <div>{t('wizard.export.saved', { path: result.path })}</div>
          {result.secrets.length > 0 && <div className="small">{t('wizard.export.secrets', { refs: result.secrets.join(', ') })}</div>}
        </Notice>
      )}
      {result && !result.path && <p className="small muted" role="status">{t('wizard.export.cancelled')}</p>}
    </div>
  );
}

interface ImportProps {
  runningId: string;
  workspaces: WorkspaceInfo[];
  /** Offer "new workspace" as a target (the wizard on a fresh install only imports into the workspace it is running). */
  allowNew: boolean;
  onApplied?: (result: ImportResult) => void;
  onRestart?: (name: string) => void;
}

type TargetChoice = 'new' | 'running' | 'other';

/** Picks a config file, shows what it would change (diff, secrets asked for, programs it would run, missing paths) and applies it. */
export function ConfigImport({ runningId, workspaces, allowNew, onApplied, onRestart }: ImportProps) {
  const t = useT();
  const others = workspaces.filter((w) => w.id !== runningId);
  const [path, setPath] = useState<string | null>(null);
  const [choice, setChoice] = useState<TargetChoice>(allowNew ? 'new' : 'running');
  const [name, setName] = useState('');
  const [otherId, setOtherId] = useState(others[0]?.id ?? '');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SecretDraft>>({});
  const [storage, setStorage] = useState<SecretsStorageStatus | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void wizardApi.config().then((v) => setStorage(v.storage), () => undefined);
  }, []);

  const target: ImportTarget | null = useMemo(() => {
    if (choice === 'new') return { mode: 'new', name: name.trim() };
    if (choice === 'running') return { mode: 'existing', id: runningId };
    return otherId ? { mode: 'existing', id: otherId } : null;
  }, [choice, name, runningId, otherId]);
  const previewKey = choice === 'new' ? 'new' : choice === 'running' ? runningId : otherId;

  useEffect(() => {
    if (!path || !target) return;
    let live = true;
    setError(null);
    setResult(null);
    wizardApi.importPreview({ path }, target).then(
      (p) => {
        if (!live) return;
        setPreview(p);
        if (choice === 'new' && !name.trim() && p.workspaceName) setName(p.workspaceName);
      },
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
    // the preview depends on the file and on which workspace it lands in, not on the name typed
  }, [path, previewKey]);

  const pick = async () => {
    setError(null);
    try {
      const p = await wizardApi.importPick();
      if (p) {
        setPreview(null);
        setPath(p);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };

  const apply = async () => {
    if (!path || !target || !preview?.ok) return;
    setError(null);
    setBusy(true);
    try {
      const secrets: SecretInput[] = [];
      for (const need of preview.secrets) {
        if (need.satisfied) continue;
        const r = secretInputFrom(need.ref, drafts[need.ref] ?? emptySecretDraft());
        if ('input' in r) secrets.push(r.input);
      }
      const r = await wizardApi.importApply({ source: { path }, target, secrets });
      setResult(r);
      onApplied?.(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const useWorkspace = async (id: string) => {
    setError(null);
    try {
      const list = await workspaceApi.list();
      const r = await workspaceApi.switchTo(id);
      if (r.restarting) onRestart?.(list.list.find((w) => w.id === id)?.name ?? id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const ready = !!preview?.ok && (choice !== 'new' || name.trim().length > 0);

  return (
    <div className="wz-stack">
      <p className="small muted">{t('wizard.import.hint')}</p>
      <div className="wz-actions">
        <button type="button" className="btn" onClick={() => void pick()}>{t(path ? 'wizard.import.another' : 'wizard.import.pick')}</button>
        {path && <span className="small mono wz-path">{path}</span>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      {path && (
        <fieldset className="wz-fieldset">
          <legend className="wz-label">{t('wizard.import.target')}</legend>
          {allowNew && (
            <label className="wz-radio">
              <input type="radio" name="import-target" checked={choice === 'new'} onChange={() => setChoice('new')} />
              <span>{t('wizard.import.targetNew')}</span>
            </label>
          )}
          <label className="wz-radio">
            <input type="radio" name="import-target" checked={choice === 'running'} onChange={() => setChoice('running')} />
            <span>{t('wizard.import.targetRunning')}</span>
          </label>
          {others.length > 0 && (
            <label className="wz-radio">
              <input type="radio" name="import-target" checked={choice === 'other'} onChange={() => setChoice('other')} />
              <span>{t('wizard.import.targetOther')}</span>
            </label>
          )}
          {choice === 'new' && (
            <Field label={t('wizard.import.newName')} htmlFor="import-name">
              <input id="import-name" className="text-input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          {choice === 'other' && (
            <Field label={t('wizard.import.otherWorkspace')} htmlFor="import-other">
              <select id="import-other" className="text-input" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                {others.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          )}
          {choice !== 'new' && <p className="small muted">{t('wizard.import.replaceNote')}</p>}
        </fieldset>
      )}

      {path && !preview && !error && <span className="spinner" aria-label={t('wizard.loading')} />}

      {preview && !preview.ok && (
        <Notice tone="error">
          <div>{t('wizard.import.invalid')}</div>
          <ul className="wz-list">{preview.errors.map((e, i) => <li key={i} className="mono small">{e.path ? `${e.path}: ` : ''}{e.message}</li>)}</ul>
        </Notice>
      )}

      {preview?.ok && (
        <div className="wz-stack" data-testid="import-preview">
          {preview.migrated.length > 0 && <Notice tone="info">{t('wizard.import.migrated', { count: preview.migrated.length })}</Notice>}
          {preview.warnings.length > 0 && (
            <Notice tone="warn">
              <ul className="wz-list">{preview.warnings.map((w, i) => <li key={i} className="small">{w.path}: {w.message}</li>)}</ul>
            </Notice>
          )}
          {preview.commands.length > 0 && (
            <Notice tone="warn">
              <strong>{t('wizard.import.commands')}</strong>
              <ul className="wz-list">{preview.commands.map((c) => <li key={c.field} className="small"><span className="mono">{c.command}</span> <span className="muted">({c.field})</span></li>)}</ul>
              <div className="small">{t('wizard.import.commandsHint')}</div>
            </Notice>
          )}
          {preview.missingPaths.length > 0 && (
            <Notice tone="info">
              <strong>{t('wizard.import.missingPaths', { count: preview.missingPaths.length })}</strong>
              <ul className="wz-list">{preview.missingPaths.slice(0, 12).map((p) => <li key={p.field} className="small mono">{p.path}</li>)}</ul>
            </Notice>
          )}
          <details className="wz-details">
            <summary>{t('wizard.import.changes', { count: preview.changes.length })}</summary>
            <ul className="wz-diff">
              {preview.changes.slice(0, 200).map((c) => (
                <li key={c.path}>
                  <span className={`wz-diff-kind wz-diff-${c.kind}`}>{c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : '~'}</span>
                  <span className="mono small">{c.path}</span>
                  <span className="small muted mono">{c.kind === 'changed' ? `${short(c.before)} → ${short(c.after)}` : short(c.kind === 'added' ? c.after : c.before)}</span>
                </li>
              ))}
            </ul>
          </details>

          {preview.secrets.length > 0 && storage && (
            <div className="wz-stack">
              <h3 className="wz-sub">{t('wizard.import.secrets')}</h3>
              <p className="small muted">{t('wizard.import.secretsHint')}</p>
              {preview.secrets.map((need) => (
                <div key={need.ref} className="wz-secret-card">
                  <div><span className="mono">{need.ref}</span> <span className="small muted">({need.usedBy.join(', ')})</span></div>
                  {need.satisfied ? (
                    <p className="small" style={{ color: 'var(--teal-ink)' }}>{t('wizard.import.secretHave')}</p>
                  ) : (
                    <SecretFields
                      noun={t('wizard.noun.secret')}
                      draft={drafts[need.ref] ?? emptySecretDraft()}
                      onChange={(d) => setDrafts((all) => ({ ...all, [need.ref]: d }))}
                      storage={storage}
                      onAcceptInsecure={() => void wizardApi.acceptInsecure().then((s) => setStorage((cur) => (cur ? { ...cur, ...s } : cur)))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="wz-actions">
            <button type="button" className="btn btn-dark" disabled={busy || !ready || !!result} onClick={() => void apply()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.import.apply')}
            </button>
          </div>
        </div>
      )}

      {result && (
        <Notice tone="ok" role="status">
          <div>{t(result.appliedToRunning ? 'wizard.import.doneRunning' : result.created ? 'wizard.import.doneNew' : 'wizard.import.doneOther')}</div>
          {result.missingSecrets.length > 0 && <div className="small">{t('wizard.import.missingSecrets', { refs: result.missingSecrets.join(', ') })}</div>}
          {!result.appliedToRunning && (
            <div className="wz-actions">
              <button type="button" className="btn btn-dark" onClick={() => void useWorkspace(result.workspaceId)}>{t('wizard.import.use')}</button>
            </div>
          )}
        </Notice>
      )}
    </div>
  );
}
