import { useEffect, useState } from 'react';
import { DEFAULT_REMOTE_DATA_DIR, LOCAL_INSTANCE, type InstanceDef, type InstanceTest, type InstanceVia, type InstancesView } from '../../../shared/instances';
import { emptySecretDraft, secretInputFrom } from '../../../shared/wizard';
import { errorText } from '../api';
import { useT } from '../i18n';
import { ROLE_LABEL, instancesApi } from '../instancesApi';
import { isWeb } from '../platform';
import { Field, Notice, SecretFields, secretProblemKey } from '../wizard/ui';
import { RestartOverlay } from './WorkspacesSection';
import '../instances.css';

const TARGET_EXAMPLE = 'coxia@example.com'; // i18n-ignore: example address

const EMPTY_FORM = { name: '', sshTarget: '', remoteDataDir: '', workspace: '', via: 'server' as InstanceVia };

// Settings › Instances: the core on this computer, or an instance on a server reached through SSH. The choice takes a relaunch, like the workspace's. The window of a paired browser has none.
export function InstancesSection() {
  const t = useT();
  const web = isWeb();
  const [view, setView] = useState<InstancesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, InstanceTest>>({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; sshTarget: string; remoteDataDir: string; workspace: string; via: InstanceVia }>(EMPTY_FORM);
  const [key, setKey] = useState(emptySecretDraft());

  useEffect(() => {
    if (web) return;
    instancesApi.list().then(setView, (e) => setError(errorText(e)));
  }, [web]);

  if (web) return null;

  const run = async (job: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const test = (id: string) =>
    run(async () => {
      const r = await instancesApi.test(id);
      setTests((s) => ({ ...s, [id]: r }));
    });
  const trust = (id: string, fp: string) =>
    run(async () => {
      const r = await instancesApi.trust(id, fp);
      setTests((s) => ({ ...s, [id]: r }));
    });

  const choose = (id: string, name: string) =>
    run(async () => {
      const r = await instancesApi.select(id);
      if (r.restarting) setRestarting(name);
      else setView(await instancesApi.list());
    });

  const add = () =>
    run(async () => {
      const r = secretInputFrom('instance.key', key);
      if ('problem' in r) throw new Error(t(secretProblemKey(r.problem)));
      const { ref: _ref, ...source } = r.input;
      setView(await instancesApi.add({ ...form, key: source }));
      setForm(EMPTY_FORM);
      setKey(emptySecretDraft());
    });

  const rows: { id: string; name: string; def?: InstanceDef }[] = [{ id: LOCAL_INSTANCE, name: t('ui.settings.instances.local') }, ...(view?.list ?? []).map((d) => ({ id: d.id, name: d.name, def: d }))];

  return (
    <div className="panel wz-settings" aria-labelledby="cfg-instances">
      <div>
        <h3 id="cfg-instances" className="wz-sub">{t('ui.settings.instances.title')}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.instances.hint')}</p>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <ul className="inst-list">
        {rows.map((r) => {
          const result = tests[r.id];
          return (
            <li key={r.id} className="inst-item">
              <div className="ws-title">
                <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.name}</span>
                {view?.running === r.id && <span className="badge badge-now">{t('ui.settings.instances.inUse')}</span>}
                {view?.running !== r.id && view?.current === r.id && <span className="badge badge-quiet">{t('ui.settings.instances.nextStart')}</span>}
              </div>
              {r.def && <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{r.def.sshTarget} · {r.def.workspace}</div>}
              <div className="ws-actions">
                {view && view.current !== r.id && <button type="button" className="btn btn-dark" disabled={busy} onClick={() => void choose(r.id, r.name)}>{t('ui.settings.instances.select')}</button>}
                {r.def && <button type="button" className="btn" disabled={busy} onClick={() => void test(r.id)}>{t('ui.settings.instances.test')}</button>}
                {r.def && view?.running !== r.id && <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => setView(await instancesApi.remove(r.id)))}>{t('ui.settings.instances.remove')}</button>}
              </div>
              {result?.ok === true && <Notice tone="info">{t('ui.settings.instances.testOk', { workspace: result.workspace, role: t(ROLE_LABEL[result.role]) })}</Notice>}
              {result?.ok === false && result.code === 'failed' && <div className="error" role="alert">{result.message}</div>}
              {result?.ok === false && result.code === 'host-unknown' && (
                <Notice tone="warn">
                  <div>{t('ui.settings.instances.hostUnknown')}</div>
                  {result.fingerprints.map((fp) => (
                    <div key={fp} className="wz-actions">
                      <span className="inst-fp">{fp}</span>
                      <button type="button" className="btn" disabled={busy} onClick={() => void trust(r.id, fp)}>{t('ui.settings.instances.trust')}</button>
                    </div>
                  ))}
                </Notice>
              )}
            </li>
          );
        })}
      </ul>
      <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="wz-label">{t('ui.settings.instances.add')}</div>
        <Field label={t('ui.settings.instances.name')} htmlFor="inst-name"><input id="inst-name" className="text-input" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t('ui.settings.instances.target')} htmlFor="inst-target"><input id="inst-target" className="text-input mono" spellCheck={false} placeholder={TARGET_EXAMPLE} value={form.sshTarget} onChange={(e) => setForm({ ...form, sshTarget: e.target.value })} /></Field>
        <Field label={t('ui.settings.instances.via')} htmlFor="inst-via">
          <select id="inst-via" className="text-input" value={form.via} onChange={(e) => setForm({ ...form, via: e.target.value as InstanceVia })}>
            <option value="server">{t('ui.settings.instances.via.server')}</option>
            <option value="socket">{t('ui.settings.instances.via.socket')}</option>
          </select>
        </Field>
        <Field label={t('ui.settings.instances.dataDir')} htmlFor="inst-dir"><input id="inst-dir" className="text-input mono" spellCheck={false} placeholder={DEFAULT_REMOTE_DATA_DIR} value={form.remoteDataDir} onChange={(e) => setForm({ ...form, remoteDataDir: e.target.value })} /></Field>
        <Field label={t('ui.settings.instances.workspace')} htmlFor="inst-ws"><input id="inst-ws" className="text-input mono" spellCheck={false} value={form.workspace} onChange={(e) => setForm({ ...form, workspace: e.target.value })} /></Field>
        <SecretFields noun={t('ui.settings.instances.key')} draft={key} onChange={setKey} storage={view?.storage ?? { secure: false, backend: null, insecureAccepted: false, canStore: false }} onAcceptInsecure={() => void run(async () => { const storage = await instancesApi.acceptInsecure(); setView((v) => (v ? { ...v, storage } : v)); })} />
        <div className="wz-actions">
          <button type="submit" className="btn" disabled={busy || !form.name.trim() || !form.sshTarget.trim() || !form.workspace.trim()}>{t('ui.settings.instances.save')}</button>
        </div>
      </form>
      {restarting && <RestartOverlay name={restarting} />}
    </div>
  );
}
