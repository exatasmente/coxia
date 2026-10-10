import { useState } from 'react';
import type { LlmProvider, LlmRole, ModelRef, ProviderKind } from '../../../../shared/config/types';
import type { CatalogModel } from '../../../../shared/modelCatalog';
import { poolFieldsOf, poolWithoutProvider } from '../../../../shared/config/pool';
import { DEFAULT_POOL_MODE, LLM_ROLES, POOL_MODES } from '../../../../shared/config/types';
import {
  DOC_LINKS,
  OPEN_PRESETS,
  PROVIDER_CHOICES,
  type PresetId,
  type ProviderDraft,
  type ProviderTestResult,
  ROLE_TIERS,
  type SecretDraft,
  buildProvider,
  capabilityWarnings,
  emptySecretDraft,
  presetById,
  providerSecretRef,
  recommendModel,
  recommendRoles,
  secretInputFrom,
} from '../../../../shared/wizard';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { PoolEditor } from '../PoolEditor';
import { applyCatalogOffer, poolListCount, withModelFacts, withProbed, withRolePool, withoutLead } from '../poolEdit';
import { SuggestedPool } from '../SuggestedPool';
import { Chip, ExternalLink, Field, Notice, SecretFields, secretProblemKey } from '../ui';
import { wizardApi } from '../wizardApi';

const REGION_PLACEHOLDER = 'us-east-1'; // i18n-ignore: cloud region name
const VERTEX_REGION_PLACEHOLDER = 'global'; // i18n-ignore: cloud region name

const blankDraft = (kind: ProviderKind = 'anthropic'): ProviderDraft => ({ kind, preset: 'openai', baseUrl: kind === 'openai-compatible' ? presetById('openai').baseUrl : '', options: {}, model: '' });

type TestState = { running: true } | { running: false; result: ProviderTestResult };

/** The test of one model of a pool, shown where the person asked for it. */
interface ModelTest {
  where: 'panel' | 'roles';
  provider: string;
  model: string;
  state: TestState;
}

function TestResultView({ p, state }: { p: LlmProvider; state: TestState }) {
  const t = useT();
  if (state.running) return <div className="small row" role="status"><span className="spinner" aria-hidden="true" /> {t('wizard.models.testing')}</div>;
  const r = state.result;
  const warnings = r.ok && r.engine === 'open' ? capabilityWarnings(r.capabilities) : [];
  return (
    <div className="wz-result" role="status">
      <Notice tone={r.ok ? 'ok' : 'error'}>
        <strong>{t(r.ok ? 'wizard.models.testOk' : `wizard.models.testFail.${r.code}`)}</strong>
        {r.ok && <span className="small"> {t('wizard.models.testMs', { ms: r.ms })}</span>}
        {!r.ok && r.detail && r.code !== 'sdk-missing' && <div className="small mono wz-wrap-anywhere">{r.detail}</div>}
        {!r.ok && r.messages.length > 0 && <ul className="wz-list">{r.messages.map((m, i) => <li key={i} className="small">{m}</li>)}</ul>}
      </Notice>
      {r.ok && r.capabilities && (
        <div className="wz-chips" aria-label={t('wizard.models.capabilities')}>
          <Chip ok={r.capabilities.chat}>{t('wizard.cap.chat')}</Chip>
          <Chip ok={r.capabilities.tools}>{t('wizard.cap.tools')}</Chip>
          <Chip ok={r.capabilities.jsonSchema}>{t('wizard.cap.jsonSchema')}</Chip>
          <Chip ok={r.capabilities.streaming}>{t('wizard.cap.streaming')}</Chip>
          {r.engine === 'open' && <Chip ok={r.capabilities.images ?? null}>{t('wizard.cap.images')}</Chip>}
          <Chip ok={null}>{r.capabilities.contextWindow ? t('wizard.cap.context', { tokens: r.capabilities.contextWindow.toLocaleString(intlLocale()) }) : t('wizard.cap.contextUnknown')}</Chip>
        </div>
      )}
      {warnings.filter((w) => w !== 'untested').map((w) => <Notice key={w} tone="warn">{t(`wizard.warn.${w}`)}</Notice>)}
      {r.ok && r.engine === 'open' && r.messages.length > 0 && (
        <details className="wz-details"><summary>{t('wizard.models.details')}</summary><ul className="wz-list">{r.messages.map((m, i) => <li key={i} className="small">{m}</li>)}</ul></details>
      )}
      {r.ok && r.models.length > 0 && <p className="small muted">{t('wizard.models.listed', { count: r.models.length })}</p>}
      {p.engine === 'claude-sdk' && r.ok && <p className="small muted">{t('wizard.models.sdkAnswered')}</p>}
    </div>
  );
}

export function ModelsStep({ cfg, setCfg, view, refreshView }: StepProps) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft>(blankDraft());
  const [useKey, setUseKey] = useState(true);
  const [secret, setSecret] = useState<SecretDraft>(emptySecretDraft());
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<SecretDraft>(emptySecretDraft());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recFor, setRecFor] = useState('');
  // What each provider's listing said (from its connection test), kept with what a test of one model found out.
  const [catalogs, setCatalogs] = useState<Record<string, CatalogModel[]>>({});
  const [modelTest, setModelTest] = useState<ModelTest | null>(null);

  const providers = cfg.llm.providers;
  const kindInfo = PROVIDER_CHOICES.find((k) => k.kind === draft.kind);
  const preset = draft.kind === 'openai-compatible' ? presetById(draft.preset) : null;
  const keyOptional = draft.kind === 'bedrock' || draft.kind === 'foundry' || (preset !== null && !preset.keyRequired);
  const keyOffered = draft.kind !== 'vertex';
  const keyOn = keyOffered && (!keyOptional || useKey);

  const acceptInsecure = () => void wizardApi.acceptInsecure().then(refreshView, (e) => setError(errorText(e)));
  const keyOf = (p: LlmProvider) => (p.secretRef ? view.secrets.find((s) => s.ref === p.secretRef) : undefined);

  const setKind = (kind: ProviderKind) => {
    setDraft(blankDraft(kind));
    setUseKey(kind === 'anthropic');
    setSecret(emptySecretDraft());
    setError(null);
  };
  const setPreset = (id: PresetId) => {
    const pr = presetById(id);
    setDraft((d) => ({ ...d, preset: id, baseUrl: pr.baseUrl, model: '' }));
    setUseKey(pr.keyRequired);
  };

  const draftProblem = (): string | null => {
    const o = draft.options;
    if (draft.kind === 'openai-compatible' && !/^https?:\/\/\S+$/.test(draft.baseUrl.trim())) return 'wizard.models.problem.baseUrl';
    if (draft.kind === 'bedrock' && !o.region?.trim()) return 'wizard.models.problem.region';
    if (draft.kind === 'vertex' && !(o.project?.trim() && o.region?.trim())) return 'wizard.models.problem.vertex';
    if (draft.kind === 'foundry' && !o.resource?.trim()) return 'wizard.models.problem.resource';
    return null;
  };

  const runTest = async (p: LlmProvider, config = cfg) => {
    setTests((all) => ({ ...all, [p.id]: { running: true } }));
    try {
      await wizardApi.save(config);
      const model = Object.values(config.llm.roles).find((r) => r.provider === p.id)?.model ?? p.models[0];
      const result = await wizardApi.testProvider(p.id, model);
      setTests((all) => ({ ...all, [p.id]: { running: false, result } }));
      if (result.ok && result.engine === 'open') {
        setCatalogs((all) => ({ ...all, [p.id]: result.catalog }));
        // What the catalog says of each model (flex, effort, retirement) is written on the provider's entries in the draft; nothing is swapped and nothing is saved here.
        setCfg((c) =>
          applyCatalogOffer(
            {
              ...c,
              llm: { ...c.llm, providers: c.llm.providers.map((x) => (x.id === p.id ? { ...x, capabilities: result.capabilities, models: [...new Set([...x.models, ...result.models])].slice(0, 200) } : x)) },
            },
            p.id,
            result.catalog,
            result.deprecations,
          ),
        );
      }
    } catch (e) {
      setTests((all) => ({ ...all, [p.id]: { running: false, result: { ok: false, engine: p.engine, code: 'failed', detail: errorText(e), messages: [], capabilities: null, models: [], catalog: [], answered: false, ms: 0 } } }));
    }
  };

  // The test of one model of a pool: nothing is saved by it. What it finds (images, window, reasoning) goes to the entries of that model in the draft.
  const testModel = async (ref: ModelRef, where: ModelTest['where']) => {
    const p = providers.find((x) => x.id === ref.provider);
    if (!p) return;
    const at = { where, provider: ref.provider, model: ref.model };
    setModelTest({ ...at, state: { running: true } });
    try {
      const result = await wizardApi.testProvider(ref.provider, ref.model);
      setModelTest({ ...at, state: { running: false, result } });
      if (result.ok && result.engine === 'open') {
        setCatalogs((all) => ({ ...all, [ref.provider]: withProbed(all[ref.provider] ?? [], result.catalog, ref.model) }));
        const caps = result.capabilities;
        setCfg((c) => withModelFacts(c, ref.provider, ref.model, { images: caps?.images, contextWindow: caps?.contextWindow, reasoning: caps?.reasoning }));
      }
    } catch (e) {
      setModelTest({ ...at, state: { running: false, result: { ok: false, engine: p.engine, code: 'failed', detail: errorText(e), messages: [], capabilities: null, models: [], catalog: [], answered: false, ms: 0 } } });
    }
  };
  const testing = modelTest?.state.running ? `${modelTest.provider}\n${modelTest.model}` : null;
  const modelTestView = (where: ModelTest['where'], providerId?: string) => {
    if (!modelTest || modelTest.where !== where || (providerId !== undefined && modelTest.provider !== providerId)) return null;
    const p = providers.find((x) => x.id === modelTest.provider);
    if (!p) return null;
    return (
      <div className="wz-stack">
        <div className="small"><strong>{t('wizard.pool.testOf', { model: `${modelTest.provider} · ${modelTest.model}` })}</strong></div>
        <TestResultView p={p} state={modelTest.state} />
      </div>
    );
  };

  const add = async () => {
    setError(null);
    const problem = draftProblem();
    if (problem) {
      setError(t(problem));
      return;
    }
    setBusy(true);
    try {
      const provider = buildProvider(draft, providers.map((p) => p.id), keyOn);
      if (keyOn) {
        const r = secretInputFrom(providerSecretRef(provider.id), secret);
        if ('problem' in r) {
          if (!keyOptional) {
            setError(t(secretProblemKey(r.problem)));
            return;
          }
          provider.secretRef = null;
        } else await wizardApi.secretSet(r.input);
      }
      const next = { ...cfg, llm: { ...cfg.llm, providers: [...providers, provider] } };
      setCfg(() => next);
      await wizardApi.save(next);
      await refreshView();
      setAdding(false);
      setDraft(blankDraft());
      setSecret(emptySecretDraft());
      if (provider.engine === 'open' && preset?.local) void runTest(provider, next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async (p: LlmProvider) => {
    setError(null);
    const ref = p.secretRef ?? providerSecretRef(p.id);
    const r = secretInputFrom(ref, keyDraft);
    if ('problem' in r) {
      setError(t(secretProblemKey(r.problem)));
      return;
    }
    try {
      await wizardApi.secretSet(r.input);
      if (!p.secretRef) setCfg((c) => ({ ...c, llm: { ...c.llm, providers: c.llm.providers.map((x) => (x.id === p.id ? { ...x, secretRef: ref } : x)) } }));
      setKeyFor(null);
      setKeyDraft(emptySecretDraft());
      await refreshView();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = (p: LlmProvider) => {
    const rest = providers.filter((x) => x.id !== p.id);
    if (!rest.length) return;
    setCfg((c) => {
      const fallback = rest[0];
      const roles = { ...c.llm.roles };
      for (const r of LLM_ROLES) {
        // The entries of the provider going away leave every pool; a role that was on it starts over on the new provider, with the pool it had.
        const pool = poolWithoutProvider(roles[r], p.id);
        const { fallbacks: _f, activities: _a, ...bare } = roles[r];
        roles[r] = roles[r].provider === p.id ? { provider: fallback.id, model: recommendModel(fallback, ROLE_TIERS[r]) ?? roles[r].model, ...pool } : { ...bare, ...pool };
      }
      return { ...c, llm: { ...c.llm, providers: rest, roles } };
    });
    if (p.secretRef === providerSecretRef(p.id)) void wizardApi.secretRemove(p.secretRef).then(refreshView, () => undefined);
    setTests((all) => {
      const { [p.id]: _gone, ...others } = all;
      return others;
    });
  };

  const setRole = (role: LlmRole, patch: Partial<{ provider: string; model: string }>) =>
    setCfg((c) => {
      const cur = c.llm.roles[role];
      const providerChanged = patch.provider !== undefined && patch.provider !== cur.provider;
      const prov = c.llm.providers.find((p) => p.id === (patch.provider ?? cur.provider));
      const model = patch.model ?? (providerChanged && prov ? (recommendModel(prov, ROLE_TIERS[role]) ?? '') : cur.model);
      // The pool stays with the role; what was known of the old model (images, window, reasoning echo) does not.
      // A reserve that is the new model of the role is the same model twice: it leaves the reserves.
      const lead = { provider: patch.provider ?? cur.provider, model };
      return { ...c, llm: { ...c.llm, roles: { ...c.llm.roles, [role]: { ...lead, ...poolFieldsOf(withoutLead(cur, lead)) } } } };
    });

  const applyRecommendations = (providerId: string) => {
    const prov = providers.find((p) => p.id === providerId);
    const rec = prov ? recommendRoles([prov]) : null;
    if (rec) setCfg((c) => ({ ...c, llm: { ...c.llm, roles: rec } }));
  };

  const roleWarnings = (role: LlmRole): string[] => {
    const rm = cfg.llm.roles[role];
    const p = providers.find((x) => x.id === rm.provider);
    if (!p || p.engine !== 'open') return [];
    return capabilityWarnings(p.capabilities).map((w) => `wizard.warn.${w}`).filter((k) => k !== 'wizard.warn.no-json-schema');
  };

  return (
    <div className="wz-stack">
      <Notice tone="info">{t('wizard.models.noSubscription')}</Notice>
      <Notice tone="info">{t('wizard.models.noModelNoAgent')}</Notice>
      {error && <div className="error" role="alert">{error}</div>}

      <section className="wz-stack" aria-labelledby="wz-providers">
        <h3 id="wz-providers" className="wz-sub">{t('wizard.models.providers')}</h3>
        <ul className="wz-cards">
          {providers.map((p) => {
            const key = keyOf(p);
            const state = tests[p.id];
            return (
              <li key={p.id} className="wz-card-item">
                <div className="wz-card-head">
                  <div>
                    <div className="wz-card-title">{t(`wizard.kind.${p.kind}`)} <span className="small muted mono">{p.id}</span></div>
                    <div className="small muted wz-wrap-anywhere">
                      {p.baseUrl && <span className="mono">{p.baseUrl}</span>}
                      {Object.keys(p.options).length > 0 && <span className="mono"> {Object.entries(p.options).map(([k, v]) => `${k}=${v}`).join(' ')}</span>}
                    </div>
                  </div>
                  <span className="badge badge-quiet">{t(p.engine === 'open' ? 'wizard.engine.open' : 'wizard.engine.sdk')}</span>
                </div>
                {p.secretRef !== null && (
                  <div className="small row" style={{ gap: 8 }}>
                    {key?.available ? <span style={{ color: 'var(--teal-ink)' }}>✓ {t('wizard.models.keyOk', { source: t(`wizard.secret.source.${key.source}`) })}</span> : <span style={{ color: 'var(--warn)' }}>{key ? t('wizard.models.keyUnavailable') : t('wizard.models.keyMissing')}</span>}
                  </div>
                )}
                <div className="wz-actions">
                  <button type="button" className="btn" disabled={!!state && state.running} onClick={() => void runTest(p)}>{t('wizard.models.test')}</button>
                  {p.kind !== 'vertex' && <button type="button" className="btn" onClick={() => { setKeyFor(keyFor === p.id ? null : p.id); setKeyDraft(emptySecretDraft()); }}>{t(key ? 'wizard.models.changeKey' : 'wizard.models.setKey')}</button>}
                  <button type="button" className="btn" disabled={providers.length < 2} title={providers.length < 2 ? t('wizard.models.removeLast') : undefined} onClick={() => remove(p)}>{t('wizard.models.remove')}</button>
                </div>
                {keyFor === p.id && (
                  <div className="wz-stack">
                    <SecretFields noun={t('wizard.noun.key')} draft={keyDraft} onChange={setKeyDraft} storage={view.storage} onAcceptInsecure={acceptInsecure} />
                    <div className="wz-actions">
                      <button type="button" className="btn btn-dark" onClick={() => void saveKey(p)}>{t('wizard.secret.save')}</button>
                      <button type="button" className="btn" onClick={() => setKeyFor(null)}>{t('wizard.cancel')}</button>
                    </div>
                  </div>
                )}
                {state && <TestResultView p={p} state={state} />}
                {state && !state.running && state.result.ok && state.result.engine === 'open' && (
                  <>
                    <SuggestedPool provider={p} catalog={catalogs[p.id] ?? state.result.catalog} cfg={cfg} setCfg={setCfg} onTest={(ref) => void testModel(ref, 'panel')} testing={testing} />
                    {modelTestView('panel', p.id)}
                  </>
                )}
                <datalist id={`models-${p.id}`}>{p.models.map((m) => <option key={m} value={m} />)}</datalist>
              </li>
            );
          })}
        </ul>

        {!adding ? (
          <div className="wz-actions"><button type="button" className="btn" onClick={() => setAdding(true)}>{t('wizard.models.add')}</button></div>
        ) : (
          <form className="wz-card-item wz-stack" onSubmit={(e) => { e.preventDefault(); void add(); }} aria-label={t('wizard.models.add')}>
            <Field label={t('wizard.models.kind')} htmlFor="wz-kind">
              <select id="wz-kind" className="text-input" value={draft.kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
                {PROVIDER_CHOICES.map((k) => <option key={k.kind} value={k.kind}>{t(`wizard.kind.${k.kind}`)}</option>)}
              </select>
            </Field>
            <p className="small muted">{t(`wizard.kind.${draft.kind}.hint`)}</p>

            {draft.kind === 'openai-compatible' && (
              <>
                <Field label={t('wizard.models.preset')} htmlFor="wz-preset">
                  <select id="wz-preset" className="text-input" value={draft.preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
                    {OPEN_PRESETS.map((p) => <option key={p.id} value={p.id}>{t(`wizard.preset.${p.id}`)}</option>)}
                  </select>
                </Field>
                <Field label={t('wizard.models.baseUrl')} htmlFor="wz-base" hint={t('wizard.models.baseUrlHint')}>
                  <input id="wz-base" className="text-input mono" inputMode="url" spellCheck={false} value={draft.baseUrl} onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))} />
                </Field>
                <Field label={t('wizard.models.model')} htmlFor="wz-model" hint={t('wizard.models.modelHint')}>
                  <input id="wz-model" className="text-input mono" spellCheck={false} placeholder={preset?.suggestedModels[0] ?? ''} value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} />
                </Field>
                {preset?.local && <Notice tone="info">{t('wizard.models.localHint')}</Notice>}
                {preset?.keyUrl && <p className="small"><ExternalLink href={preset.keyUrl}>{t('wizard.models.createKey')}</ExternalLink></p>}
              </>
            )}
            {draft.kind === 'bedrock' && (
              <>
                <Field label={t('wizard.models.region')} htmlFor="wz-region" hint={t('wizard.models.bedrockRegionHint')}>
                  <input id="wz-region" className="text-input mono" placeholder={REGION_PLACEHOLDER} spellCheck={false} value={draft.options.region ?? ''} onChange={(e) => setDraft((d) => ({ ...d, options: { ...d.options, region: e.target.value } }))} />
                </Field>
                <Field label={t('wizard.models.awsProfile')} htmlFor="wz-profile" hint={t('wizard.models.awsProfileHint')}>
                  <input id="wz-profile" className="text-input mono" spellCheck={false} value={draft.options.profile ?? ''} onChange={(e) => setDraft((d) => ({ ...d, options: { ...d.options, profile: e.target.value } }))} />
                </Field>
                <Notice tone="info">{t('wizard.models.bedrockCreds')} <ExternalLink href={DOC_LINKS.bedrock}>{t('wizard.docs')}</ExternalLink></Notice>
              </>
            )}
            {draft.kind === 'vertex' && (
              <>
                <Field label={t('wizard.models.gcpProject')} htmlFor="wz-gcp">
                  <input id="wz-gcp" className="text-input mono" spellCheck={false} value={draft.options.project ?? ''} onChange={(e) => setDraft((d) => ({ ...d, options: { ...d.options, project: e.target.value } }))} />
                </Field>
                <Field label={t('wizard.models.region')} htmlFor="wz-vregion" hint={t('wizard.models.vertexRegionHint')}>
                  <input id="wz-vregion" className="text-input mono" placeholder={VERTEX_REGION_PLACEHOLDER} spellCheck={false} value={draft.options.region ?? ''} onChange={(e) => setDraft((d) => ({ ...d, options: { ...d.options, region: e.target.value } }))} />
                </Field>
                <Notice tone="info">{t('wizard.models.vertexCreds')} <ExternalLink href={DOC_LINKS.vertex}>{t('wizard.docs')}</ExternalLink></Notice>
              </>
            )}
            {draft.kind === 'foundry' && (
              <>
                <Field label={t('wizard.models.foundryResource')} htmlFor="wz-resource" hint={t('wizard.models.foundryResourceHint')}>
                  <input id="wz-resource" className="text-input mono" spellCheck={false} value={draft.options.resource ?? ''} onChange={(e) => setDraft((d) => ({ ...d, options: { ...d.options, resource: e.target.value } }))} />
                </Field>
                <Notice tone="info">{t('wizard.models.foundryCreds')} <ExternalLink href={DOC_LINKS.foundry}>{t('wizard.docs')}</ExternalLink></Notice>
              </>
            )}
            {draft.kind === 'anthropic' && <p className="small"><ExternalLink href={DOC_LINKS.anthropicKeys}>{t('wizard.models.createKey')}</ExternalLink></p>}

            {keyOffered && (
              <div className="wz-stack">
                {keyOptional && (
                  <label className="wz-radio">
                    <input type="checkbox" checked={useKey} onChange={(e) => setUseKey(e.target.checked)} />
                    <span>{t(draft.kind === 'bedrock' ? 'wizard.models.useToken' : 'wizard.models.useKey')}</span>
                  </label>
                )}
                {keyOn && <SecretFields noun={t(draft.kind === 'bedrock' ? 'wizard.noun.token' : 'wizard.noun.key')} draft={secret} onChange={setSecret} storage={view.storage} onAcceptInsecure={acceptInsecure} />}
              </div>
            )}
            {kindInfo && !kindInfo.claude && <p className="small muted">{t('wizard.models.openEngineNote')}</p>}

            <div className="wz-actions">
              <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.models.addSubmit')}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => { setAdding(false); setError(null); }}>{t('wizard.cancel')}</button>
            </div>
          </form>
        )}
      </section>

      <section className="wz-stack" aria-labelledby="wz-roles">
        <div className="wz-roles-head">
          <h3 id="wz-roles" className="wz-sub">{t('wizard.models.roles')}</h3>
          {providers.length > 0 && (
            <div className="wz-actions">
              <label className="wz-sr" htmlFor="wz-rec-provider">{t('wizard.models.recommendFor')}</label>
              <select id="wz-rec-provider" className="text-input" style={{ maxWidth: 220 }} value={providers.some((p) => p.id === recFor) ? recFor : providers[providers.length - 1].id} onChange={(e) => setRecFor(e.target.value)}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
              </select>
              <button type="button" className="btn" onClick={() => applyRecommendations(providers.some((p) => p.id === recFor) ? recFor : providers[providers.length - 1].id)}>{t('wizard.models.recommend')}</button>
            </div>
          )}
        </div>
        <p className="small muted">{t('wizard.models.rolesHint')}</p>
        {modelTestView('roles')}
        {LLM_ROLES.map((role) => {
          const rm = cfg.llm.roles[role];
          const prov = providers.find((p) => p.id === rm.provider);
          const rec = prov ? recommendModel(prov, ROLE_TIERS[role]) : null;
          return (
            <div key={role} className="wz-role">
              <div>
                <div className="wz-label">{t(`wizard.role.${role}`)}</div>
                <div className="small muted">{t(`wizard.role.${role}.hint`)}</div>
              </div>
              <div className="wz-role-pick">
                <select className="text-input" aria-label={t('wizard.models.roleProvider', { role: t(`wizard.role.${role}`) })} value={rm.provider} onChange={(e) => setRole(role, { provider: e.target.value })}>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
                <input className="text-input mono" list={`models-${rm.provider}`} spellCheck={false} aria-label={t('wizard.models.roleModel', { role: t(`wizard.role.${role}`) })} value={rm.model} onChange={(e) => setRole(role, { model: e.target.value.trim() })} />
              </div>
              {rec && rec !== rm.model && <button type="button" className="btn wz-linkbtn" onClick={() => setRole(role, { model: rec })}>{t('wizard.models.useRecommended', { model: rec })}</button>}
              {roleWarnings(role).map((k) => <Notice key={k} tone="warn">{t(k)}</Notice>)}
              <details className="wz-details" open={poolListCount(rm) > 0 || undefined}>
                <summary>{t('wizard.pool.summary', { count: poolListCount(rm) })}</summary>
                <PoolEditor
                  providers={providers}
                  primary={{ provider: rm.provider, model: rm.model, ...(rm.contextWindow !== undefined ? { contextWindow: rm.contextWindow } : {}) }}
                  value={rm}
                  onChange={(pool) => setCfg((c) => withRolePool(c, role, pool))}
                  catalogs={catalogs}
                  overrides={cfg.llm.scoreOverrides}
                  onTest={(ref) => void testModel(ref, 'roles')}
                  testing={testing}
                />
              </details>
            </div>
          );
        })}
      </section>

      <fieldset className="wz-stack wz-fieldset" aria-labelledby="wz-poolmode">
        <legend id="wz-poolmode" className="wz-sub">{t('wizard.poolMode.title')}</legend>
        <p className="small muted">{t('wizard.poolMode.intro')}</p>
        {POOL_MODES.map((m) => {
          const current = cfg.llm.poolMode ?? DEFAULT_POOL_MODE;
          return (
            <label key={m} className={`wz-card-item wz-choice ${current === m ? 'wz-on' : ''}`}>
              <input type="radio" name="pool-mode" checked={current === m} onChange={() => setCfg((c) => ({ ...c, llm: { ...c.llm, poolMode: m } }))} />
              <span>
                <span className="wz-card-title">{t(`wizard.poolMode.${m}`)}</span>
                <span className="small muted wz-block">{t(`wizard.poolMode.${m}.hint`)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
