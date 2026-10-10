import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { latestStep, stepText } from './activity';
import { ActivityTree, Chevron } from './ActivityTree';
import { buildTree } from './activityTreeModel';
import { useT } from './i18n';
import { formatElapsed } from './jobs';
import { useActivity } from './useActivity';
import './activity.css';

function useElapsed(since: number): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return formatElapsed(now - since);
}

/** "What the agent is doing" under a spinner: collapsed it is the latest step and the elapsed time, expanded it is the tree of what it and the agents under it do. `agent` is the agent a call asked for. */
export function AgentActivity({ jobId, since, agent }: { jobId: string | undefined; since?: number; agent?: string }) {
  const t = useT();
  const entries = useActivity(jobId);
  const nodes = useMemo(() => buildTree(entries), [entries]);
  const [open, setOpen] = useState(false);
  const body = useId();
  const mounted = useRef(Date.now());
  const elapsed = useElapsed(since ?? mounted.current);
  if (jobId === undefined) return null;
  const step = latestStep(entries);
  const title = agent ? t('activity.call.title', { agent }) : t('activity.title');
  return (
    <section className="act" aria-label={title}>
      <button type="button" className="act-head" aria-expanded={open} aria-controls={body} onClick={() => setOpen((o) => !o)}>
        <Chevron open={open} />
        <span className="act-head-text">
          <span className="act-title">{title}</span>
          <span className="act-now" aria-live="off">{step ? stepText(step, t('activity.thought')) : t('activity.waiting')}</span>
        </span>
        <span className="act-elapsed">{elapsed}</span>
        <span className="sr-only">{open ? t('activity.hide') : t('activity.show')}</span>
      </button>
      {open && (
        <div id={body}>
          <ActivityTree nodes={nodes} />
        </div>
      )}
    </section>
  );
}
