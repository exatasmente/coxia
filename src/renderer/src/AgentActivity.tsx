import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ActivityEntry } from '../../shared/activity';
import { atBottom, latestStep } from './activity';
import { useT } from './i18n';
import { formatElapsed } from './jobs';
import { useActivity } from './useActivity';
import './activity.css';

function KindIcon({ entry }: { entry: ActivityEntry }) {
  const t = useT();
  const bad = entry.state === 'failed' || entry.state === 'blocked';
  const d =
    entry.kind === 'tool'
      ? 'M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-2z'
      : entry.kind === 'text'
        ? 'M5 7h14M5 12h14M5 17h9'
        : entry.state === 'finished'
          ? 'M5 12.5l4.5 4.5L19 7.5'
          : bad
            ? 'M12 7v6m0 3.5v.5'
            : 'M12 8v4l3 2';
  return (
    <svg className={`act-icon ${bad ? 'act-icon-bad' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={t(`activity.kind.${entry.kind}`)}>
      <path d={d} />
    </svg>
  );
}

/** Time, icon per kind and label of each step; follows the newest line unless the person scrolled up. */
export function ActivityTimeline({ entries }: { entries: readonly ActivityEntry[] }) {
  const t = useT();
  const box = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const first = entries[0]?.at ?? 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    follow.current = atBottom(el);
    setAway(!follow.current);
  };
  const jump = () => {
    const el = box.current;
    if (!el) return;
    follow.current = true;
    el.scrollTop = el.scrollHeight;
    setAway(false);
  };

  return (
    <div className="act-timeline-wrap">
      <ol ref={box} className="act-timeline" role="log" aria-label={t('activity.timeline')} onScroll={onScroll} tabIndex={0}>
        {entries.length === 0 && <li className="act-empty">{t('activity.empty')}</li>}
        {entries.map((e) => (
          <li key={`${e.runId}:${e.seq}`} className={`act-step act-${e.kind} ${e.state === 'blocked' || e.state === 'failed' ? 'act-bad' : ''}`}>
            <time className="act-time">{formatElapsed(e.at - first)}</time>
            <KindIcon entry={e} />
            <span className="act-label">{e.label}</span>
          </li>
        ))}
      </ol>
      {away && (
        <button type="button" className="act-latest" onClick={jump}>
          {t('activity.latest')}
        </button>
      )}
    </div>
  );
}

function useElapsed(since: number): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return formatElapsed(now - since);
}

/** "What the agent is doing" under a spinner: collapsed it is the latest step and the elapsed time, expanded it is the timeline. */
export function AgentActivity({ jobId, since }: { jobId: string | undefined; since?: number }) {
  const t = useT();
  const entries = useActivity(jobId);
  const [open, setOpen] = useState(false);
  const body = useId();
  const mounted = useRef(Date.now());
  const elapsed = useElapsed(since ?? mounted.current);
  if (jobId === undefined) return null;
  const step = latestStep(entries);
  return (
    <section className="act" aria-label={t('activity.title')}>
      <button type="button" className="act-head" aria-expanded={open} aria-controls={body} onClick={() => setOpen((o) => !o)}>
        <svg className={`act-chevron ${open ? 'act-chevron-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="act-head-text">
          <span className="act-title">{t('activity.title')}</span>
          <span className="act-now" aria-live="off">{step ? step.label : t('activity.waiting')}</span>
        </span>
        <span className="act-elapsed">{elapsed}</span>
        <span className="sr-only">{open ? t('activity.hide') : t('activity.show')}</span>
      </button>
      {open && (
        <div id={body}>
          <ActivityTimeline entries={entries} />
        </div>
      )}
    </section>
  );
}
