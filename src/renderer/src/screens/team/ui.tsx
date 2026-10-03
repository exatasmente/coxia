import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkspaceConfig } from '../../../../shared/config/types';
import { useT } from '../../i18n';
import { Sheet } from '../Sheet';
import './team.css';

// The small pieces the team and cycle screens share: a switch, the panel that opens beside a list (a bottom sheet on a phone), a list of problems.

const NARROW = '(max-width: 760px)'; // i18n-ignore: media query

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** True where a side panel has no room beside its list: the panel is then a bottom sheet. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches, () => false);
}

/** An on/off switch with its label; `label` is also what a screen reader reads. */
export function Toggle({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; hint?: string }) {
  return (
    <label className={`tm-switch${disabled ? ' tm-disabled' : ''}`} title={hint}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="tm-track" aria-hidden="true"><span className="tm-thumb" /></span>
      <span className="tm-switch-label">{label}</span>
    </label>
  );
}

/** The editor of one item: beside its list on a wide screen, a bottom sheet (Esc closes, focus stays inside) where there is no room. */
export function SidePanel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const narrow = useNarrow();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!narrow) head.current?.focus();
  }, [narrow]);
  if (narrow) return <Sheet label={label} onClose={onClose}>{children}</Sheet>;
  return (
    <aside className="panel tm-panel" aria-label={label} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="row spread">
        <h3 ref={head} tabIndex={-1} className="tm-panel-title">{label}</h3>
        <button type="button" className="btn" onClick={onClose}>{t('ui.sheet.close')}</button>
      </div>
      {children}
    </aside>
  );
}

export interface Problem {
  severity: 'error' | 'warning';
  text: string;
}

/** The problems of a draft: errors in the red tone, warnings in the amber one, each announced to a screen reader. */
export function Problems({ items }: { items: Problem[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <ul className="tm-problems" role="status" aria-label={t('ui.team.checks.aria')}>
      {items.map((p, i) => (
        <li key={i} className={`tm-problem tm-problem-${p.severity}`}>
          <span className="tm-problem-tag">{p.severity === 'error' ? t('ui.team.checks.error') : t('ui.team.checks.warning')}</span> {p.text}
        </li>
      ))}
    </ul>
  );
}

/** A label and its control; the label is tied to the control through the id the render function gets. */
export function Labeled({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="wz-field">
      <label className="wz-label" htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="small muted">{hint}</div>}
      {error && <div className="tm-field-error small" role="alert">{error}</div>}
    </div>
  );
}

/** A confirmation that sits where the action was, in the amber tone of the workspaces screen. */
export function Confirm({ children, confirmLabel, onConfirm, onCancel, danger }: { children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  const t = useT();
  return (
    <div className={`ws-confirm${danger ? ' ws-danger' : ''}`} role="alertdialog" aria-label={confirmLabel}>
      <div>{children}</div>
      <div className="ws-actions">
        <button type="button" className={`btn ${danger ? 'btn-red' : 'btn-dark'}`} onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className="btn" onClick={onCancel}>{t('ui.team.cancel')}</button>
      </div>
    </div>
  );
}

/** What the container hands every section: the configuration as it is, how to save a whole new one (it gives back what was saved, and throws what the main process refuses), and how to read it again. */
export interface SectionProps {
  config: WorkspaceConfig;
  save: (next: WorkspaceConfig) => Promise<WorkspaceConfig>;
  reload: () => void;
}

/** A list of short texts (labels, file names) that grows with an Add button or Enter and shrinks with the x on each chip. `add` decides what a new text does to the list (trim, no duplicates). */
export function ChipsInput({ label, hint, addLabel, removeLabel, values, onChange, add, error }: { label: string; hint?: string; addLabel: string; removeLabel: (value: string) => string; values: string[]; onChange: (next: string[]) => void; add: (values: string[], text: string) => string[]; error?: string }) {
  const [text, setText] = useState('');
  const push = () => {
    onChange(add(values, text));
    setText('');
  };
  return (
    <Labeled label={label} hint={hint} error={error}>
      {(id) => (
        <>
          <div className="tm-tags">
            {values.map((v) => (
              <span key={v} className="tm-tag">
                <span className="mono">{v}</span>
                <button type="button" className="tm-tag-x" aria-label={removeLabel(v)} onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
              </span>
            ))}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
            <input id={id} className="text-input mono" spellCheck={false} maxLength={100} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); push(); } }} />
            <button type="button" className="btn" disabled={!text.trim()} onClick={push}>{addLabel}</button>
          </div>
        </>
      )}
    </Labeled>
  );
}
