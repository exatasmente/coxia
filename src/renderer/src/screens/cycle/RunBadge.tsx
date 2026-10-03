import { type Run, type RunStatus } from '../../../../shared/runs';
import { RUN_TONE, stageLabelOf } from '../../../../shared/runs/view';
import { useT } from '../../i18n';
import './cycle.css';

// The key of each status, spelled out so the catalog check finds every one of them.
const STATUS_KEY: Record<RunStatus, string> = {
  working: 'ui.cycle.status.working',
  gate: 'ui.cycle.status.gate',
  question: 'ui.cycle.status.question',
  'to-start': 'ui.cycle.status.toStart',
  'to-accept': 'ui.cycle.status.toAccept',
  waiting: 'ui.cycle.status.waiting',
  failed: 'ui.cycle.status.failed',
  done: 'ui.cycle.status.done',
  cancelled: 'ui.cycle.status.cancelled',
};

/** What the status says, in words. */
export function useStatusText(): (status: RunStatus) => string {
  const t = useT();
  return (status) => t(STATUS_KEY[status]);
}

/** The state of a run as a badge: the stage's name in its title, the status on it. */
export function RunBadge({ run, withStage = false }: { run: Pick<Run, 'status' | 'stage' | 'flow'>; withStage?: boolean }) {
  const t = useT();
  const stage = stageLabelOf(run);
  const text = t(STATUS_KEY[run.status]);
  return (
    <span className={`badge cy-badge cy-tone-${RUN_TONE[run.status]}`} title={t('ui.cycle.badge.title', { stage, status: text })}>
      {withStage ? t('ui.cycle.badge.withStage', { stage, status: text }) : text}
    </span>
  );
}
