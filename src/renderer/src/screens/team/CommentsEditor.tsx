import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommentEventKey, CommentTemplate } from '../../../../shared/config/types';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { addSection, commentTargets, moveSection, patchSection, patchTemplate, PLACEHOLDERS, removeSection, renderSample, starterTemplate, templateProblems } from './commentEdit';
import { EVENT_LABEL } from './labels';
import { shown } from './text';
import { Labeled, Problems, Toggle, type Problem, type SectionProps } from './ui';

/** Settings › Comments: the template of each comment the runner leaves on the tracker, with the comment it would write rendered beside it. */
export function CommentsEditor({ config, save }: SectionProps) {
  const t = useT();
  const [draft, setDraft] = useState<Record<string, CommentTemplate>>(() => structuredClone(config.devCycle.comments));
  const [key, setKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const base = useMemo(() => JSON.stringify(config.devCycle.comments), [config.devCycle.comments]);
  const dirty = JSON.stringify(draft) !== base;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(structuredClone(config.devCycle.comments));
  }, [config.devCycle.comments]);

  const stages = useMemo(() => [...config.devCycle.stages, ...Object.values(config.devCycle.flows ?? {}).flat()], [config]);
  const targets = useMemo(() => commentTargets(stages, draft), [stages, draft]);
  const current = targets.find((x) => x.key === key) ?? targets[0] ?? null;
  const tpl = current ? draft[current.key] : undefined;
  const label = (x: { key: string; kind: string; label: string }): string => (x.kind === 'event' ? t(EVENT_LABEL[x.key as CommentEventKey]) : x.kind === 'other' ? t('ui.comments.other', { key: x.key }) : x.label);
  const language = config.language;

  const set = (next: CommentTemplate) => {
    if (!current) return;
    setSaved(false);
    setDraft((d) => ({ ...d, [current.key]: next }));
  };
  const all = useMemo(() => Object.entries(draft).flatMap(([k, v]) => templateProblems(v, language).map((p) => ({ k, p }))), [draft, language]);
  const errors = all.filter((x) => x.p.severity === 'error').length;
  const problems: Problem[] = tpl ? templateProblems(tpl, language).map((p) => ({ severity: p.severity, text: t(p.key, p.params) })) : [];
  const elsewhere = all.filter((x) => x.k !== current?.key && x.p.severity === 'error').map((x) => ({ severity: 'error' as const, text: `${x.k}: ${t(x.p.key, x.p.params)}` }));

  const sample = tpl && current
    ? renderSample(tpl, language, current.kind === 'stage' ? current.label : t(EVENT_LABEL[current.key as CommentEventKey]), {
        body: (n) => t('ui.comments.sample.body', { n }),
        technical: t('ui.comments.sample.technical'),
        result: t('ui.comments.sample.result'),
        decision: t('ui.comments.sample.decision'),
        fallback: t('ui.comments.sample.body', { n: 1 }),
      })
    : '';

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const done = await save({ ...config, devCycle: { ...config.devCycle, comments: draft } });
      setDraft(structuredClone(done.devCycle.comments));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wz-stack">
      <p className="small muted">{t('ui.comments.hint')}</p>
      <div className="tm-bar">
        <label className="tm-bar-item">
          <span className="wz-label">{t('ui.comments.which')}</span>
          <select className="text-input" value={current?.key ?? ''} onChange={(e) => setKey(e.target.value)}>
            {targets.map((x) => <option key={x.key} value={x.key}>{label(x)}{x.has ? '' : ` — ${t('ui.comments.none')}`}</option>)}
          </select>
        </label>
      </div>

      {current && !tpl && (
        <div className="panel">
          <p>{t('ui.comments.noTemplate', { name: label(current) })}</p>
          <div className="wz-actions">
            <button type="button" className="btn btn-dark" onClick={() => set(starterTemplate(current.key, { title: label(current), status: t('ui.comments.new.status'), heading: t('ui.comments.new.heading') }))}>{t('ui.comments.add')}</button>
          </div>
        </div>
      )}

      {current && tpl && (
        <div className="tm-split tm-flow" data-open="true">
          <div className="wz-stack">
            <Labeled label={t('ui.comments.f.title')} hint={t('ui.comments.f.titleHint')}>
              {(id) => <input id={id} className="text-input" maxLength={200} value={shown(tpl.title)} onChange={(e) => set(patchTemplate(tpl, { title: e.target.value }))} />}
            </Labeled>
            <Labeled label={t('ui.comments.f.status')} hint={t('ui.comments.f.statusHint', { list: PLACEHOLDERS.map((p) => `{${p}}`).join(' ') })}>
              {(id) => <input id={id} className="text-input" maxLength={400} value={shown(tpl.status)} onChange={(e) => set(patchTemplate(tpl, { status: e.target.value }))} />}
            </Labeled>

            <fieldset className="wz-fieldset">
              <legend className="wz-label">{t('ui.comments.f.sections')}</legend>
              <p className="small muted">{t('ui.comments.f.sectionsHint')}</p>
              {tpl.sections.map((s, i) => (
                <div key={i} className="tm-section">
                  <div className="row spread" style={{ flexWrap: 'nowrap' }}>
                    <span className="small muted">{t('ui.comments.section', { n: i + 1 })}</span>
                    <div className="tm-row-actions">
                      <button type="button" className="btn tm-mini" aria-label={t('ui.comments.up', { n: i + 1 })} disabled={i === 0} onClick={() => set(moveSection(tpl, i, -1))}>↑</button>
                      <button type="button" className="btn tm-mini" aria-label={t('ui.comments.down', { n: i + 1 })} disabled={i === tpl.sections.length - 1} onClick={() => set(moveSection(tpl, i, 1))}>↓</button>
                      <button type="button" className="btn tm-mini tm-danger" aria-label={t('ui.comments.removeSection', { n: i + 1 })} onClick={() => set(removeSection(tpl, i))}>×</button>
                    </div>
                  </div>
                  <Labeled label={t('ui.comments.f.heading')}>
                    {(id) => <input id={id} className="text-input" maxLength={200} value={shown(s.heading)} onChange={(e) => set(patchSection(tpl, i, { heading: e.target.value }))} />}
                  </Labeled>
                  <Labeled label={t('ui.comments.f.guidance')}>
                    {(id) => <textarea id={id} className="text-input" rows={2} maxLength={2000} value={shown(s.guidance)} onChange={(e) => set(patchSection(tpl, i, { guidance: e.target.value }))} />}
                  </Labeled>
                </div>
              ))}
              <div className="wz-actions"><button type="button" className="btn" disabled={tpl.sections.length >= 20} onClick={() => set(addSection(tpl, { heading: t('ui.comments.new.heading'), guidance: '' }))}>{t('ui.comments.addSection')}</button></div>
            </fieldset>

            <Toggle checked={tpl.technicalDetail} onChange={(technicalDetail) => set(patchTemplate(tpl, { technicalDetail }))} label={t('ui.comments.f.technical')} />
            <p className="small muted">{t('ui.comments.f.technicalHint')}</p>
            <Problems items={problems} />
            <div className="wz-actions"><button type="button" className="btn tm-danger" onClick={() => { setSaved(false); setDraft((d) => { const { [current.key]: _gone, ...rest } = d; return rest; }); }}>{t('ui.comments.remove')}</button></div>
          </div>
          <div className="wz-stack tm-diagram-box">
            <div className="wz-label">{t('ui.comments.preview')}</div>
            <pre className="tm-preview" aria-label={t('ui.comments.preview')}>{sample}</pre>
            <p className="small muted">{t('ui.comments.previewNote')}</p>
          </div>
        </div>
      )}

      <Problems items={elsewhere} />
      {error && <div className="error" role="alert">{error}</div>}
      <div className="tm-savebar">
        <span className="small muted" role="status">{saved && !dirty ? t('ui.comments.saved') : errors > 0 ? t('ui.comments.blocked', { count: errors }) : dirty ? t('ui.flow.unsaved') : t('ui.flow.clean')}</span>
        <div className="wz-actions">
          {dirty && <button type="button" className="btn" onClick={() => setDraft(structuredClone(config.devCycle.comments))}>{t('ui.flow.discard')}</button>}
          <button type="button" className="btn btn-dark" disabled={!dirty || errors > 0 || saving} onClick={() => void submit()}>{saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.save')}</button>
        </div>
      </div>
    </div>
  );
}
