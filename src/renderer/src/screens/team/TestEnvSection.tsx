import { useCallback, useEffect, useState } from 'react';
import type { TestEnvSecret, TestEnvVariable } from '../../../../shared/config/types';
import type { SecretInfo } from '../../../../shared/secrets';
import { api, errorText } from '../../api';
import { isWeb } from '../../platform';
import { useT } from '../../i18n';
import { ChipsInput, Labeled, Toggle, type SectionProps } from './ui';

// Settings › Test environment: what an allowed stage of a run may exercise the app under development with. Plain variables carry their values in the
// workspace configuration; the secrets are references into the secrets store under the `test.` prefix — the main process resolves each on the computer,
// at launch, and no value is ever shown here. A secret not marked test-only needs the person's confirmation, once, before any stage launches with it;
// the confirmation and its revoke are recorded in the audit log.

const addHost = (list: string[], text: string): string[] => (text.trim() && !list.includes(text.trim().toLowerCase()) ? [...list, text.trim().toLowerCase()] : list);

export function TestEnvSection({ config, save }: SectionProps) {
  const t = useT();
  const web = isWeb();
  const [vars, setVars] = useState<TestEnvVariable[]>(config.testEnvironment?.variables ?? []);
  const [confirmations, setConfirmations] = useState<string[]>([]);
  const [storeRows, setStoreRows] = useState<SecretInfo[]>([]);
  const [open, setOpen] = useState<'var' | 'secret' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = JSON.stringify(config.testEnvironment?.variables ?? []);
  const dirty = JSON.stringify(vars) !== base;

  // The secrets list as the store holds it (never a value), kept current with the configuration.
  useEffect(() => {
    void api.invoke<{ secrets: SecretInfo[] }>('config:get').then((v) => setStoreRows(v.secrets), (e) => setError(errorText(e)));
  }, [config]);

  // The draft follows the configuration saved anywhere; unsaved edits of the variables stay.
  useEffect(() => {
    if (!dirty) setVars(config.testEnvironment?.variables ?? []);
  }, [config.testEnvironment?.variables]);

  const reloadConfirmations = useCallback(() => {
    void api.invoke<{ ref: string }[]>('config:testenv-confirmations').then((list) => setConfirmations(list.map((e) => e.ref)), (e) => setError(errorText(e)));
  }, []);
  useEffect(reloadConfirmations, [reloadConfirmations]);

  const savedSecrets = config.testEnvironment?.secrets ?? [];
  const availability = new Map(storeRows.map((s) => [s.ref, s.available]));
  // The store lists every test secret there; the configuration's saved metadata wins when both speak of one.
  const rows: (TestEnvSecret & { available: boolean })[] = [
    ...savedSecrets.map((s) => ({ ...s, available: availability.get(s.ref) ?? false })),
    ...storeRows.filter((s) => s.ref.startsWith('test.') && !savedSecrets.some((x) => x.ref === s.ref)).map((s) => ({ ref: s.ref, testOnly: true, hosts: [], privateHosts: [], available: s.available })),
  ];

  if (web) {
    return (
      <section className="wz-stack" aria-label={t('ui.testenv.title')}>
        <p className="small muted" role="note">{t('ui.testenv.webNote')}</p>
      </section>
    );
  }

  const saveVariables = async (): Promise<void> => {
    try {
      await save({ ...config, testEnvironment: { variables: vars, secrets: savedSecrets } });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const savedVars = (): TestEnvVariable[] => config.testEnvironment?.variables ?? [];

  const removeSecret = async (ref: string): Promise<void> => {
    try {
      await api.invoke('config:secret-remove', ref);
      await save({ ...config, testEnvironment: { variables: savedVars(), secrets: savedSecrets.filter((s) => s.ref !== ref) } });
      reloadConfirmations();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="wz-stack" aria-label={t('ui.testenv.title')}>
      <h3 className="wz-label">{t('ui.testenv.title')}</h3>
      <p className="small muted">{t('ui.testenv.hint')}</p>
      {error && <div className="error" role="alert">{error}</div>}

      <fieldset className="wz-fieldset">
        <legend className="wz-label">{t('ui.testenv.variables')}</legend>
        <p className="small muted">{t('ui.testenv.variablesHint')}</p>
        {vars.length === 0 && <p className="small muted">{t('ui.testenv.empty')}</p>}
        {vars.map((v) => (
          <div key={v.name} className="row spread tm-row">
            <span className="mono small">{v.name}={v.value}</span>
            <span className="small muted mono">{(v.hosts ?? []).join(', ') || '—'}</span>
            <button type="button" className="btn" aria-label={t('ui.testenv.remove', { name: v.name })} onClick={() => setVars((list) => list.filter((x) => x.name !== v.name))}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setOpen('var')}>{t('ui.testenv.addVariable')}</button>
      </fieldset>

      <fieldset className="wz-fieldset">
        <legend className="wz-label">{t('ui.testenv.secrets')}</legend>
        <p className="small muted">{t('ui.testenv.secretsHint')}</p>
        {rows.length === 0 && <p className="small muted">{t('ui.testenv.empty')}</p>}
        {rows.map((s) => (
          <div key={s.ref} className="row spread tm-row">
            <span className="mono small">{s.ref}</span>
            <span className="small muted">
              {t(s.testOnly ? 'ui.testenv.testOnly' : 'ui.testenv.needsConfirm', { state: s.testOnly ? '' : confirmations.includes(s.ref) ? t('ui.testenv.confirmed') : t('ui.testenv.unconfirmed') })}
              {!s.available ? ` · ${t('ui.testenv.unavailable')}` : ''}
            </span>
            <button type="button" className="btn" aria-label={t('ui.testenv.remove', { name: s.ref })} onClick={() => void removeSecret(s.ref)}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setOpen('secret')}>{t('ui.testenv.addSecret')}</button>
      </fieldset>

      {savedSecrets.some((s) => !s.testOnly) && (
        <button type="button" className="btn" onClick={() => {
          void (async () => {
            try {
              for (const ref of savedSecrets.filter((s) => !s.testOnly).map((s) => s.ref)) await api.invoke('config:secret-remove', ref);
              reloadConfirmations();
            } catch (e) {
              setError(errorText(e));
            }
          })();
        }}>{t('ui.testenv.deleteGroup')}</button>
      )}

      {open === 'var' && <VariableEditor onAdd={(v) => { setVars((list) => [...list.filter((x) => x.name !== v.name), v]); setOpen(null); }} />}
      {open === 'secret' && (
        <SecretEditor
          known={new Set(rows.map((r) => r.ref))}
          confirmed={confirmations}
          onConfirmed={reloadConfirmations}
          onAdd={async (s) => {
            setOpen(null);
            try {
              await save({ ...config, testEnvironment: { variables: savedVars(), secrets: [...savedSecrets.filter((x) => x.ref !== s.ref), s] } });
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
      )}

      <p className="small muted">{t('ui.testenv.saveNote')}</p>
      <div className="tm-savebar">
        <span className="small muted" role="status">{dirty ? t('ui.testenv.unsaved') : t('ui.testenv.saved')}</span>
        <button type="button" className="btn btn-dark" disabled={!dirty} onClick={() => void saveVariables()}>{t('ui.team.save')}</button>
      </div>
    </section>
  );
}

function VariableEditor({ onAdd }: { onAdd: (v: TestEnvVariable) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [hosts, setHosts] = useState<string[]>([]);
  return (
    <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); onAdd({ name: name.trim().toUpperCase(), value, hosts, privateHosts: [] }); }}>
      <Labeled label={t('ui.testenv.varName')} hint={t('ui.testenv.varNameHint')}>{(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />}</Labeled>
      <Labeled label={t('ui.testenv.varValue')} hint={t('ui.testenv.varValueHint')}>{(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={4000} value={value} onChange={(e) => setValue(e.target.value)} />}</Labeled>
      <ChipsInput label={t('ui.testenv.hosts')} hint={t('ui.testenv.hostsHint')} addLabel={t('ui.squads.f.labelAdd')} removeLabel={(h) => t('ui.runner.sandbox.hostRemove', { host: h })} values={hosts} onChange={setHosts} add={addHost} />
      <button type="submit" className="btn btn-dark" disabled={!name.trim() || !value}>{t('ui.testenv.add')}</button>
    </form>
  );
}

/** One secret: the value typed here goes to the store at once (`config:secret-set`, never into the configuration) and the ref stays as the saved metadata. */
function SecretEditor({ known, confirmed, onAdd, onConfirmed }: { known: Set<string>; confirmed: string[]; onAdd: (s: TestEnvSecret) => Promise<void>; onConfirmed: () => void }) {
  const t = useT();
  const [suffix, setSuffix] = useState('');
  const [value, setValue] = useState('');
  const [testOnly, setTestOnly] = useState(true);
  const [hosts, setHosts] = useState<string[]>([]);
  const [privateHosts, setPrivateHosts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ref = `test.${suffix.trim().toLowerCase()}`;
  const store = async () => api.invoke('config:secret-set', { ref, source: 'stored', value });

  const submit = async (): Promise<void> => {
    try {
      await store();
      await onAdd({ ref, testOnly, hosts, privateHosts });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const confirm = async (): Promise<void> => {
    try {
      await api.invoke('config:testenv-confirm', ref);
      onConfirmed();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="small muted">{t('ui.testenv.secretsHint')}</p>
      {known.has(ref) && suffix.trim() ? <p className="small" role="status">{t('ui.testenv.refExists')}</p> : null}
      <Labeled label={t('ui.testenv.refName')} hint={t('ui.testenv.refNameHint')}>{(id) => <input id={id} className="text-input mono" spellCheck={false} maxLength={60} value={suffix} onChange={(e) => setSuffix(e.target.value)} />}</Labeled>
      <Labeled label={t('ui.testenv.secretValue')} hint={t('ui.testenv.secretValueHint')}>{(id) => <input id={id} type="password" className="text-input mono" autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} />}</Labeled>
      <Toggle checked={testOnly} onChange={setTestOnly} label={t('ui.testenv.testOnlyToggle')} />
      <p className="small muted">{t('ui.testenv.testOnlyHint')}</p>
      <ChipsInput label={t('ui.testenv.hosts')} hint={t('ui.testenv.hostsHint')} addLabel={t('ui.squads.f.labelAdd')} removeLabel={(h) => t('ui.runner.sandbox.hostRemove', { host: h })} values={hosts} onChange={setHosts} add={addHost} />
      <ChipsInput label={t('ui.testenv.privateHosts')} hint={t('ui.testenv.privateHostsHint')} addLabel={t('ui.squads.f.labelAdd')} removeLabel={(h) => t('ui.runner.sandbox.hostRemove', { host: h })} values={privateHosts} onChange={setPrivateHosts} add={addHost} />
      {!testOnly && !confirmed.includes(ref) && (
        <div className="wz-stack">
          <p className="small">{t('ui.testenv.confirmAsk')}</p>
          <button type="button" className="btn" onClick={() => void confirm()}>{t('ui.testenv.confirmNow')}</button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      <button type="submit" className="btn btn-dark" disabled={!suffix.trim() || !value}>{t('ui.testenv.add')}</button>
    </form>
  );
}
