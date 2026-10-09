import { useEffect, useMemo, useState } from 'react';
import type { EvidenceView } from '../../../../shared/evidence';
import { evidenceDataUrl, isEvidenceImage } from '../../../../shared/evidence';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { runsApi } from './runsApi';

// The evidence a run kept, as the person handles it: the list of a stage with a thumbnail or a card, opening it in full and downloading it, and deleting it. Reading the
// bytes goes through the runner's channel; the screen never touches the disk.

/** The bytes as the person reads them: the unit comes from the catalog, never a bare "KB" in the code. */
const size = (t: (key: string, params?: Record<string, string | number>) => string, bytes: number): string =>
  bytes >= 1024 * 1024 ? t('ui.cycle.evidenceBlock.mb', { n: (bytes / (1024 * 1024)).toFixed(1) }) : t('ui.cycle.evidenceBlock.kb', { n: Math.max(1, Math.round(bytes / 1024)) });

const stamp = (iso: string): string => new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** The image of one piece of evidence as a `data:` address, read once: the desktop's content policy refuses a `blob:` image. Only an image is shown through it. */
function useEvidenceUrl(runId: string, record: EvidenceView | null): { url: string | null; error: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setUrl(null);
    setError(false);
    if (!record) return;
    let live = true;
    void runsApi.evidenceBytes(runId, record.id).then(
      (bytes) => {
        if (!live || !bytes) {
          if (live) setError(true);
          return;
        }
        setUrl(evidenceDataUrl(bytes, record.media));
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [runId, record]);
  return { url, error };
}

/** One piece of evidence: the image (or a card for anything else), with open, download and delete. */
function EvidenceItem({ runId, record, onRemoved }: { runId: string; record: EvidenceView; onRemoved: (id: string) => void }) {
  const t = useT();
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { url, error: readFailed } = useEvidenceUrl(runId, open ? record : null);
  const image = isEvidenceImage(record.kind);
  const download = async () => {
    setError(null);
    const bytes = await runsApi.evidenceBytes(runId, record.id).catch(() => null);
    if (!bytes) {
      setError(t('ui.cycle.evidenceBlock.failed'));
      return;
    }
    const href = URL.createObjectURL(new Blob([bytes], { type: record.media }));
    const a = document.createElement('a');
    a.href = href;
    a.download = record.name || `${record.id}.${record.kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const remove = async () => {
    setError(null);
    try {
      await runsApi.removeEvidence(runId, record.id);
      onRemoved(record.id);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <li className="cy-evidence">
      <div className="row cy-evidence-head">
        <strong className="small">{record.title}</strong>
        <span className="badge cy-tone-quiet">{record.kind.toUpperCase()}</span>
        <span className="faint small">{record.by} · {stamp(record.at)}</span>
        {record.inCycle && <span className="badge cy-tone-done">{t('ui.cycle.evidenceBlock.inCycle')}</span>}
      </div>
      {record.description && <p className="small cy-evidence-desc">{record.description}</p>}
      <p className="faint small mono">{record.id} · {record.name} · {size(t, record.bytes)}{record.from ? ` · ${t('ui.cycle.evidenceBlock.from', { from: record.from })}` : ''}</p>
      {open && image && (
        <div className="cy-evidence-view">
          {readFailed && <p className="small error">{t('ui.cycle.evidenceBlock.failed')}</p>}
          {!url && !readFailed && <p className="small faint"><span className="spinner" aria-hidden="true" /> {t('ui.cycle.evidenceBlock.loading')}</p>}
          {url && <img className="cy-evidence-image" src={url} alt={record.title} />}
        </div>
      )}
      <div className="row cy-evidence-actions">
        {image && (
          <button type="button" className="btn cy-mini" aria-pressed={open} onClick={() => setOpen((v) => !v)}>{t('ui.cycle.evidenceBlock.open')}</button>
        )}
        <button type="button" className="btn cy-mini" onClick={() => void download()}>{t('ui.cycle.evidenceBlock.download')}</button>
        {asked ? (
          <span className="row cy-evidence-confirm">
            <span className="small">{t('ui.cycle.evidenceBlock.confirm', { id: record.id })}</span>
            <button type="button" className="btn cy-mini btn-dark" onClick={() => void remove()}>{t('ui.cycle.evidenceBlock.remove')}</button>
            <button type="button" className="btn cy-mini" onClick={() => setAsked(false)}>{t('ui.cycle.evidenceBlock.cancel')}</button>
          </span>
        ) : (
          <button type="button" className="btn cy-mini" onClick={() => setAsked(true)}>{t('ui.cycle.evidenceBlock.remove')}</button>
        )}
      </div>
      {error && <p className="small error" role="alert">{error}</p>}
    </li>
  );
}

/** The evidence of a run, read once and shared by the block and the scenario list; null while it is read, undefined when the read failed. */
export function useEvidenceList(runId: string): { list: EvidenceView[] | null | undefined; remove: (id: string) => void } {
  const [list, setList] = useState<EvidenceView[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setList(undefined);
    void runsApi.evidenceList(runId).then(
      (r) => {
        if (live) setList(r ?? null);
      },
      () => {
        if (live) setList(null);
      },
    );
    return () => {
      live = false;
    };
  }, [runId]);
  return { list, remove: (id: string) => setList((cur) => (cur ?? []).filter((x) => x.id !== id)) };
}

/** The evidence of one stage (or of the whole run), listed. `stage` null shows every piece the run kept. */
export function EvidenceBlock({ runId, stage, list, onRemoved }: { runId: string; stage?: string | null; list: EvidenceView[] | null | undefined; onRemoved?: (id: string) => void }) {
  const t = useT();
  const shown = useMemo(() => (list ?? []).filter((e) => !stage || e.stage === stage), [list, stage]);
  return (
    <section className="cy-evidence-block" aria-label={t('ui.cycle.evidenceBlock.title')}>
      <h4 className="cy-h">{t('ui.cycle.evidenceBlock.title')}</h4>
      {list === undefined && <p className="small faint"><span className="spinner" aria-hidden="true" /> {t('ui.cycle.evidenceBlock.loading')}</p>}
      {list !== undefined && !shown.length && <p className="small faint">{t('ui.cycle.evidenceBlock.empty')}</p>}
      {shown.length > 0 && (
        <ul className="cy-evidence-list">
          {shown.map((e) => (
            <EvidenceItem key={e.id} runId={runId} record={e} onRemoved={(id) => onRemoved?.(id)} />
          ))}
        </ul>
      )}
      {shown.some((e) => e.message !== null) && <p className="faint small">{t('ui.cycle.evidenceBlock.publishedHint')}</p>}
    </section>
  );
}

/** The file a conversation message carries: an image opens in place, anything else is a card with open and download. */
export function EvidenceAttachment({ runId, attachment }: { runId: string; attachment: { id: string; name: string; media: string; bytes: number } }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const image = attachment.media.startsWith('image/');
  const { url } = useEvidenceUrl(runId, open && image ? ({ id: attachment.id, media: attachment.media } as EvidenceView) : null);
  const download = async () => {
    setFailed(false);
    const bytes = await runsApi.evidenceBytes(runId, attachment.id).catch(() => null);
    if (!bytes) {
      setFailed(true);
      return;
    }
    const href = URL.createObjectURL(new Blob([bytes], { type: attachment.media }));
    const a = document.createElement('a');
    a.href = href;
    a.download = attachment.name || attachment.id;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  return (
    <span className="cy-evidence-attach">
      <button type="button" className="cy-evidence-link" aria-pressed={open} onClick={() => setOpen((v) => !v)}>{t('ui.cycle.evidence.attachment')}: {attachment.name || attachment.id}</button>
      <span className="faint small"> · {size(t, attachment.bytes)}</span>
      <button type="button" className="btn cy-mini" onClick={() => void download()}>{t('ui.cycle.evidenceBlock.download')}</button>
      {open && image && url && <img className="cy-evidence-thumb" src={url} alt={attachment.name} />}
      {failed && <span className="small error">{t('ui.cycle.evidenceBlock.failed')}</span>}
    </span>
  );
}

/** The evidence a scenario cites, as a list of small links that open the image of that evidence. */
export function EvidenceCites({ runId, ids, list }: { runId: string; ids: string[] | undefined; list: EvidenceView[] | null | undefined }) {
  const t = useT();
  if (!ids?.length) return null;
  const by = new Map((list ?? []).map((e) => [e.id, e]));
  return (
    <div className="cy-evidence-cites">
      <span className="faint small">{t('ui.cycle.evidence.scenario')}:</span>
      <ul className="cy-evidence-cite-list">
        {ids.map((id) => {
          const record = by.get(id);
          return (
            <li key={id}>
              <EvidenceCite runId={runId} record={record} id={id} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One cited piece: its title when the run still has the record, or just the id. */
function EvidenceCite({ runId, record, id }: { runId: string; record: EvidenceView | undefined; id: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const image = !!record && isEvidenceImage(record.kind);
  const { url } = useEvidenceUrl(runId, open && image ? (record ?? null) : null);
  if (!record) return <span className="faint small mono">{id}</span>;
  return (
    <span className="cy-evidence-cite">
      {image ? (
        <button type="button" className="cy-evidence-link" aria-pressed={open} onClick={() => setOpen((v) => !v)} title={record.title}>{record.id} · {record.title}</button>
      ) : (
        <a className="cy-evidence-link" href="#" onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}>{record.id} · {record.title}</a>
      )}
      {open && url && image && <img className="cy-evidence-thumb" src={url} alt={record.title} />}
      {open && !image && <span className="faint small"> ({t('ui.cycle.evidence.attachment')})</span>}
    </span>
  );
}
