import { useEffect, useMemo, useRef, useState } from 'react';
import { ATTACHMENT_LIMITS, type AttachmentLimits } from '../../../../shared/attachments';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { Labeled, Toggle, type SectionProps } from './ui';

// Settings › Files in the conversations: whether the box takes files, the size and count limits, and whether a called agent receives them.
// The window and a paired browser edit the same block (config:cycle-save allows it, configScope.ts).

const MB = 1024 * 1024;
const toMb = (bytes: number): string => String(Math.round((bytes / MB) * 10) / 10);
const toBytes = (value: string): number => Math.round(Number(value) * MB);

interface Draft {
  enabled: boolean;
  agents: boolean;
  imageMb: string;
  otherMb: string;
  messageMb: string;
  perMessage: string;
}

const draftOf = (limits: AttachmentLimits | undefined, enabled: boolean, agents: boolean): Draft => {
  const l = limits ?? ATTACHMENT_LIMITS;
  return { enabled, agents, imageMb: toMb(l.imageBytes), otherMb: toMb(l.otherBytes), messageMb: toMb(l.messageBytes), perMessage: String(l.perMessage) };
};

const limitsOf = (d: Draft): AttachmentLimits => ({
  imageBytes: toBytes(d.imageMb),
  otherBytes: toBytes(d.otherMb),
  messageBytes: toBytes(d.messageMb),
  perMessage: Math.max(1, Math.round(Number(d.perMessage) || 1)),
});

export function AttachmentsSection({ config, save }: SectionProps) {
  const t = useT();
  const web = isWeb();
  const current = config.attachments ?? { enabled: true, agents: true, limits: ATTACHMENT_LIMITS };
  const [draft, setDraft] = useState<Draft>(() => draftOf(current.limits, current.enabled, current.agents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const base = useMemo(() => JSON.stringify(draftOf(current.limits, current.enabled, current.agents)), [current]);
  const dirty = JSON.stringify(draft) !== base;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(draftOf(current.limits, current.enabled, current.agents));
  }, [current]);

  const set = (patch: Partial<Draft>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const num = (v: string) => (v === '' ? Number.NaN : Number(v));
  const badLimit = (v: string, min: number, max: number): boolean => !Number.isFinite(num(v)) || num(v) < min || num(v) > max;
  const problems: string[] = [];
  if (badLimit(draft.imageMb, 0.001, 50)) problems.push(t('ui.team.attachments.image.problem'));
  if (badLimit(draft.otherMb, 0.001, 50)) problems.push(t('ui.team.attachments.other.problem'));
  if (badLimit(draft.messageMb, 0.001, 100)) problems.push(t('ui.team.attachments.message.problem'));
  if (!Number.isInteger(num(draft.perMessage)) || num(draft.perMessage) < 1 || num(draft.perMessage) > 50) problems.push(t('ui.team.attachments.count.problem'));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const done = await save({ ...config, attachments: { enabled: draft.enabled, agents: draft.agents, limits: limitsOf(draft) } });
      const next = done.attachments ?? { enabled: true, agents: true, limits: ATTACHMENT_LIMITS };
      setDraft(draftOf(next.limits, next.enabled, next.agents));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="tm-section" aria-label={t('ui.team.attachments.title')}>
      <h3 className="wz-section-title">{t('ui.team.attachments.title')}</h3>
      <p className="small muted">{t('ui.team.attachments.intro')}</p>

      <Toggle checked={draft.enabled} label={t('ui.team.attachments.enabled')} hint={t('ui.team.attachments.enabled.hint')} onChange={(enabled) => set({ enabled })} />
      <Toggle checked={draft.agents} label={t('ui.team.attachments.agents')} hint={t('ui.team.attachments.agents.hint')} onChange={(agents) => set({ agents })} />

      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Labeled label={t('ui.team.attachments.image')} hint={t('ui.team.attachments.image.hint')}>
          {(id) => <input id={id} className="text-input mono" style={{ width: 90 }} inputMode="decimal" value={draft.imageMb} onChange={(e) => set({ imageMb: e.target.value })} />}
        </Labeled>
        <Labeled label={t('ui.team.attachments.other')} hint={t('ui.team.attachments.other.hint')}>
          {(id) => <input id={id} className="text-input mono" style={{ width: 90 }} inputMode="decimal" value={draft.otherMb} onChange={(e) => set({ otherMb: e.target.value })} />}
        </Labeled>
        <Labeled label={t('ui.team.attachments.message')} hint={t('ui.team.attachments.message.hint')}>
          {(id) => <input id={id} className="text-input mono" style={{ width: 90 }} inputMode="decimal" value={draft.messageMb} onChange={(e) => set({ messageMb: e.target.value })} />}
        </Labeled>
        <Labeled label={t('ui.team.attachments.count')} hint={t('ui.team.attachments.count.hint')}>
          {(id) => <input id={id} className="text-input mono" style={{ width: 70 }} inputMode="numeric" value={draft.perMessage} onChange={(e) => set({ perMessage: e.target.value })} />}
        </Labeled>
      </div>

      {problems.length > 0 && <div className="error" role="alert">{problems.join(' ')}</div>}
      {saved && <p className="small muted" role="status">{t('ui.team.attachments.saved')}</p>}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row">
        <button type="button" className="btn btn-dark" disabled={saving || !dirty || problems.length > 0} onClick={submit}>
          {saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.attachments.save')}
        </button>
      </div>
      {!web && <p className="faint small">{t('ui.team.attachments.stored')}</p>}
    </section>
  );
}
