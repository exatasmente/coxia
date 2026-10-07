import { autonomyOf, flowKeyOf, onChoices } from '../../../../shared/config/autonomy';
import type { WorkspaceConfig } from '../../../../shared/config/types';
import type { Run } from '../../../../shared/runs';
import { useT } from '../../i18n';

const CHOICE_KEY = {
  hostCommands: 'ui.cycle.autonomy.choice.hostCommands',
  gates: 'ui.cycle.autonomy.choice.gates',
  push: 'ui.cycle.autonomy.choice.push',
  pullRequest: 'ui.cycle.autonomy.choice.pullRequest',
} as const;

/**
 * The header line of a run that answers the autonomy block: whether it runs on its own, which of the four choices are on and where the decision comes from
 * (the workspace's block or the flow's own). A run of a release is left out: the block does not decide its push and its pull request.
 */
export function AutonomyNote({ run, config }: { run: Run; config: WorkspaceConfig | null }) {
  const t = useT();
  if (!config || run.subject) return null;
  const a = autonomyOf(config, flowKeyOf(run.squad));
  if (!a.cycle) return null;
  const choices = onChoices(a).map((c) => t(CHOICE_KEY[c]));
  const origin = a.from === 'flow' ? t('ui.cycle.autonomy.flow', { flow: a.flow === '' ? t('ui.cycle.autonomy.main') : (a.flow ?? '') }) : t('ui.cycle.autonomy.workspace');
  return (
    <p className="cy-note small">
      <span className="badge cy-tone-person">{t('ui.cycle.autonomy.on')}</span> {t('ui.cycle.autonomy.from', { origin })}{choices.length ? ` · ${choices.join(' · ')}` : ''}
    </p>
  );
}
