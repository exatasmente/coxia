import { useId } from 'react';
import { useT } from '../../i18n';
import { squadName } from './names';
import { useRunConfig } from './runsApi';
import './cycle.css';

const WHOLE = '';

/** Which squad a ceremony is held for: one of the workspace's squads, or all of it. Nothing at all in a workspace that has no squads. */
export function SquadPicker({ value, onChange, disabled = false, hint }: { value: string | null; onChange: (squad: string | null) => void; disabled?: boolean; hint?: string }) {
  const t = useT();
  const id = useId();
  const squads = useRunConfig()?.squads ?? [];
  if (!squads.length) return null;
  return (
    <div className="cy-squad-picker">
      <label htmlFor={id} className="small muted">{t('ui.ceremony.squad.label')}</label>
      <select id={id} className="text-input" value={value ?? WHOLE} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.value || null)}>
        <option value={WHOLE}>{t('ui.ceremony.squad.whole')}</option>
        {squads.map((s) => <option key={s.id} value={s.id}>{squadName(squads, s.id)}</option>)}
      </select>
      {hint && <span id={`${id}-hint`} className="faint small">{hint}</span>}
    </div>
  );
}

/** What a ceremony was held for, in a line: the squad's name, or the whole workspace. Shown for a squad's ceremony, and in a workspace that has squads. */
export function SquadScope({ squad }: { squad: string | null | undefined }) {
  const t = useT();
  const squads = useRunConfig()?.squads ?? [];
  if (!squad && !squads.length) return null;
  return <span className={`badge ${squad ? 'cy-tone-working' : 'cy-tone-quiet'} cy-scope`}>{squad ? t('ui.ceremony.squad.scope', { squad: squadName(squads, squad) }) : t('ui.ceremony.squad.scopeWhole')}</span>;
}
