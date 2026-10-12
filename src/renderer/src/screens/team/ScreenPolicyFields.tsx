import { STEP_KINDS, type StepKind } from '../../../../shared/browser';
import { type PolicyLevel, type ResolvedScreenPolicy, type ScreenMode, type ScreenPolicy, releasedIn } from '../../../../shared/config/screenPolicy';
import { useT } from '../../i18n';

// The screen step approvals of one level: for each kind of step the app holds, whether the agent's screen asks the person or runs without asking, with the mode in
// effect and the level it comes from. The agent and the squad may leave a kind to the next level; the workspace's word is the last one before the default, which holds.
// Drawn only on the computer: a paired browser never offers to let a kind run without asking.

const KIND_KEY: Record<StepKind, string> = {
  submit: 'ui.team.policy.kind.submit',
  name: 'ui.team.policy.kind.name',
  shortcut: 'ui.team.policy.kind.shortcut',
  dialog: 'ui.team.policy.kind.dialog',
  unclassified: 'ui.team.policy.kind.unclassified',
  agent: 'ui.team.policy.kind.agent',
};

const MODE_KEY: Record<ScreenMode | 'inherit', string> = {
  inherit: 'ui.team.policy.mode.inherit',
  held: 'ui.team.policy.mode.held',
  autonomous: 'ui.team.policy.mode.autonomous',
};

const SOURCE_KEY: Record<PolicyLevel, string> = {
  agent: 'ui.team.policy.source.agent',
  squad: 'ui.team.policy.source.squad',
  workspace: 'ui.team.policy.source.workspace',
  default: 'ui.team.policy.source.default',
};

export interface ScreenPolicyFieldsProps {
  level: Exclude<PolicyLevel, 'default'>;
  /** This level's own words. */
  value: ScreenPolicy;
  onChange: (next: ScreenPolicy) => void;
  /** What applies with the draft as it is: the mode of each kind and where it comes from. */
  effective: ResolvedScreenPolicy;
}

export function ScreenPolicyFields({ level, value, onChange, effective }: ScreenPolicyFieldsProps) {
  const t = useT();
  // The workspace has no level after it: a kind it does not name holds, which is what "asks" says.
  const choices: (ScreenMode | 'inherit')[] = level === 'workspace' ? ['held', 'autonomous'] : ['inherit', 'held', 'autonomous'];
  const set = (kind: StepKind, mode: ScreenMode | 'inherit') => {
    const next: ScreenPolicy = { ...value };
    if (mode === 'inherit') delete next[kind];
    else next[kind] = mode;
    onChange(next);
  };
  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.team.policy.title')}</legend>
      <p className="small muted">{t('ui.team.policy.hint')}</p>
      {STEP_KINDS.map((kind) => {
        const id = `screen-policy-${level}-${kind}`;
        const own = value[kind] ?? (level === 'workspace' ? 'held' : 'inherit');
        return (
          <div key={kind} className="wz-stack">
            <label className="wz-label" htmlFor={id}>{t(KIND_KEY[kind])}</label>
            <select id={id} className="text-input" value={own} onChange={(e) => set(kind, e.target.value as ScreenMode | 'inherit')}>
              {choices.map((m) => <option key={m} value={m}>{t(MODE_KEY[m])}</option>)}
            </select>
            <p className="small muted" role="status">{t('ui.team.policy.effective', { mode: t(MODE_KEY[effective[kind].mode]), source: t(SOURCE_KEY[effective[kind].source]) })}</p>
          </div>
        );
      })}
      <p className="small muted" role="note">{t('ui.team.policy.always')}</p>
      {releasedIn(value).length > 0 && <p className="small tm-assist-warn" role="note">{t('ui.team.policy.released')}</p>}
      <p className="small muted">{t('ui.team.policy.next')}</p>
    </fieldset>
  );
}
