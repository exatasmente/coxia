import type { AgentDef } from '../../../../shared/config/types';
import { COMPARE_MIN_USES, FAILING_OUT_OF_LIST, awaitsReview, compare, isOld, type ProcedureRecord } from '../../../../shared/procedures';
import { usageParams } from '../../../../shared/runs/view';
import type { StageUsage } from '../../../../shared/runs/types';
import { intlLocale, useT } from '../../i18n';
import { agentName } from '../cycle/names';
import { PERMISSION_LABEL, SHELL_LABEL } from '../team/labels';
import { STATE_LABEL, STATE_TONE, STEPS_FROM_LABEL, SURFACE_LABEL } from './labels';
import './procedures.css';

// One record in full, read only: who wrote it and with what reach, the state and why, the steps, the pitfalls, the waits, the version before and what it saved. The
// controls that change it are drawn by RecordPanel, never here, so a paired browser gets exactly this.

export const day = (iso: string): string => new Date(iso).toLocaleDateString(intlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' });

/** Who wrote a revision, in words: `person` is the reader, an agent is its name. */
export function useWho(team: readonly AgentDef[] | undefined): (by: string) => string {
  const t = useT();
  return (by) => (by === 'person' ? t('ui.procedures.person') : agentName(team, by));
}

/** The stage card's own sentence for a usage, so a number reads the same here as there. */
function usageLine(t: ReturnType<typeof useT>, usage: StageUsage): string {
  const p = usageParams(usage, intlLocale());
  const key = p.cost === null ? 'ui.cycle.stage.usage' : p.estimated ? 'ui.cycle.stage.usageCostEstimated' : 'ui.cycle.stage.usageCost';
  return t(key, { calls: p.calls, prompt: p.prompt, cached: p.cached, completion: p.completion, cost: p.cost ?? '' });
}

/** What finding the procedure cost next to what its uses cost, with the label that says it is a comparison and not a measurement. */
export function Comparison({ record }: { record: ProcedureRecord }) {
  const t = useT();
  const c = compare(record.stats);
  const n = new Intl.NumberFormat(intlLocale());
  const money = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return (
    <section className="pr-block" aria-label={t('ui.procedures.panel.usage')}>
      <h3 className="cy-h">{t('ui.procedures.panel.usage')}</h3>
      {c.uses === 0 && <p className="small muted">{t('ui.procedures.panel.usage.none')}</p>}
      {c.uses > 0 && !c.baseline && <p className="small muted">{t('ui.procedures.panel.usage.noBaseline')}</p>}
      {c.baseline && <p className="small">{t('ui.procedures.panel.usage.baseline', { line: usageLine(t, c.baseline) })}</p>}
      {c.average && c.noFailureShare !== null && (
        <>
          <p className="small">{t('ui.procedures.panel.usage.average', { line: usageLine(t, c.average) })}</p>
          <p className="small">{t('ui.procedures.panel.usage.uses', { uses: n.format(c.uses), share: new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(c.noFailureShare) })}</p>
        </>
      )}
      {c.uses > 0 && !c.enough && c.baseline && <p className="small muted">{t('ui.procedures.panel.usage.notEnough', { counted: c.counted, needed: COMPARE_MIN_USES })}</p>}
      {c.enough && !c.saved && <p className="small muted">{t('ui.procedures.panel.usage.noSaving')}</p>}
      {c.saved && (
        <p className="small pr-saved">
          {t(c.saved.costUsd === null ? 'ui.procedures.panel.usage.saved' : c.saved.costEstimated ? 'ui.procedures.panel.usage.savedCostEstimated' : 'ui.procedures.panel.usage.savedCost', {
            tokens: n.format(c.saved.tokens),
            cost: c.saved.costUsd === null ? '' : money.format(c.saved.costUsd),
          })}
        </p>
      )}
      {c.uses > 0 && <p className="faint">{t('ui.procedures.panel.usage.approximate')}</p>}
    </section>
  );
}

/** Why the record is in the state it is in, in words a person can act on. */
function StateNote({ record, now }: { record: ProcedureRecord; now: number }) {
  const t = useT();
  return (
    <div className="pr-notes">
      <p className="row small">
        <span className={`badge cy-badge ${STATE_TONE[record.state]}`}>{t(STATE_LABEL[record.state])}</span>
        {record.state === 'unverified' && <span>{t('ui.procedures.panel.stateUnverified')}</span>}
        {record.state === 'ok' && record.lastVerified && <span>{t('ui.procedures.panel.stateOk', { date: day(record.lastVerified) })}</span>}
        {record.state === 'failing' && record.lastFailed && <span>{t('ui.procedures.panel.stateFailing', { step: record.lastFailed.step, date: day(record.lastFailed.at) })}</span>}
      </p>
      {isOld(record, now) && <p className="small pr-warn">{t('ui.procedures.panel.old')}</p>}
      {record.stats.failuresSinceSave >= FAILING_OUT_OF_LIST && <p className="small pr-warn">{t('ui.procedures.panel.withheld')}</p>}
    </div>
  );
}

export function RecordBody({ record, team, now = Date.now() }: { record: ProcedureRecord; team: readonly AgentDef[] | undefined; now?: number }) {
  const t = useT();
  const who = useWho(team);
  const o = record.origin;
  return (
    <div className="pr-body">
      <div className="pr-notes">
        <p className="small">
          {t('ui.procedures.panel.origin', { revision: record.revision, who: who(o.by), surface: t(SURFACE_LABEL[o.surface]) + (o.stage ? ` (${o.stage})` : ''), date: day(o.at) })}
          {o.createdBy !== o.by && ` ${t('ui.procedures.panel.created', { who: who(o.createdBy) })}`}
        </p>
        {o.permission && o.shell && <p className="small muted">{t('ui.procedures.panel.power', { permission: t(PERMISSION_LABEL[o.permission]), shell: t(SHELL_LABEL[o.shell]) })}</p>}
        <p className="small">{record.reviewed ? t('ui.procedures.panel.reviewed') : awaitsReview(record) ? t('ui.procedures.panel.awaitsReview') : t('ui.procedures.panel.unreviewed')}</p>
        {record.kind === 'gui' && record.keyedBy === 'app' && <p className="small muted">{t('ui.procedures.panel.keyedByApp')}</p>}
        <p className="small muted">{t(STEPS_FROM_LABEL[record.stepsFrom])}</p>
      </div>
      <StateNote record={record} now={now} />
      <Steps title={t('ui.procedures.panel.steps')} steps={record.steps} />
      <List title={t('ui.procedures.panel.pitfalls')} items={record.pitfalls} />
      <List title={t('ui.procedures.panel.waits')} items={record.waits} />
      {record.previous && (
        <details className="pr-block">
          <summary className="small">{t('ui.procedures.panel.previous')}: {record.previous.title}</summary>
          <Steps title={t('ui.procedures.panel.steps')} steps={record.previous.steps} />
          <List title={t('ui.procedures.panel.pitfalls')} items={record.previous.pitfalls} />
          <List title={t('ui.procedures.panel.waits')} items={record.previous.waits} />
        </details>
      )}
      <Comparison record={record} />
    </div>
  );
}

function Steps({ title, steps }: { title: string; steps: ProcedureRecord['steps'] }) {
  const t = useT();
  if (!steps.length) return null;
  return (
    <section className="pr-block" aria-label={title}>
      <h3 className="cy-h">{title}</h3>
      <ol className="pr-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span>{s.text}</span>
            {s.edited && <span className="badge badge-quiet pr-edited">{t('ui.procedures.panel.stepEdited')}</span>}
            {s.run && <code className="pr-run mono">{s.run}</code>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <section className="pr-block" aria-label={title}>
      <h3 className="cy-h">{title}</h3>
      <ul className="pr-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </section>
  );
}
