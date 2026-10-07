import type { AutonomyBlock } from '../../../../shared/config/types';
import { useT } from '../../i18n';
import { Toggle } from './ui';

const CHOICE_KEY = {
  hostCommands: 'ui.autonomy.choice.hostCommands',
  gates: 'ui.autonomy.choice.gates',
  push: 'ui.autonomy.choice.push',
  pullRequest: 'ui.autonomy.choice.pullRequest',
} as const;

const CHOICE_HINT_KEY = {
  hostCommands: 'ui.autonomy.choice.hostCommands.hint',
  gates: 'ui.autonomy.choice.gates.hint',
  push: 'ui.autonomy.choice.push.hint',
  pullRequest: 'ui.autonomy.choice.pullRequest.hint',
} as const;

const CHOICES = ['hostCommands', 'gates', 'push', 'pullRequest'] as const;

/**
 * The five fields of one autonomy block: the general switch, and under it the four choices, which only mean anything while the general switch is on.
 * `disabled` shows the fields greyed out with the reason (the workspace's block decides for this flow); `readOnly` shows them without editing at all.
 */
export function AutonomyFields({ value, onChange, disabled = false, disabledHint, readOnly = false }: { value: AutonomyBlock; onChange?: (patch: Partial<AutonomyBlock>) => void; disabled?: boolean; disabledHint?: string; readOnly?: boolean }) {
  const t = useT();
  const set = (patch: Partial<AutonomyBlock>) => onChange?.(patch);
  const off = disabled || readOnly;
  return (
    <div className="wz-stack">
      <Toggle checked={value.cycle} onChange={(cycle) => set({ cycle })} label={t('ui.autonomy.cycle')} disabled={off} />
      <p className="small muted">{disabled ? (disabledHint ?? t('ui.autonomy.byWorkspace')) : t('ui.autonomy.cycle.hint')}</p>
      {CHOICES.map((c) => (
        <div key={c}>
          <Toggle checked={value[c]} onChange={(on) => set({ [c]: on } as Partial<AutonomyBlock>)} label={t(CHOICE_KEY[c])} disabled={off || !value.cycle} />
          <p className="small muted">{t(CHOICE_HINT_KEY[c])}</p>
        </div>
      ))}
    </div>
  );
}
