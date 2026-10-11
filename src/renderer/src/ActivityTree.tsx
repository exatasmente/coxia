import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ActivityEntry } from '../../shared/activity';
import { atBottom } from './activity';
import { type TreeItem, type TreeNode, createTreeView, defaultOpen, nodeTitle, stepText, waitsBelow } from './activityTreeModel';
import { useT } from './i18n';
import { formatElapsed } from './jobs';
import { agentName } from './screens/cycle/names';
import { useRunConfig } from './screens/cycle/runsApi';
import './activity.css';

/** Which levels the person opened or closed: held outside the components, so it survives the panel closing and new lines arriving. */
export const treeView = createTreeView();

/** Whether a level is open (the person's choice, else the default), drawn again when any choice changes. */
export function useTreeOpen(id: string, def: boolean): [boolean, () => void] {
  useSyncExternalStore(treeView.subscribe, treeView.version);
  return [treeView.open(id, def), () => treeView.toggle(id, def)];
}

/** `decorative` for a row whose own text already names the kind: the icon then says nothing a second time. */
export function KindIcon({ entry, decorative = false }: { entry: ActivityEntry; decorative?: boolean }) {
  const t = useT();
  const bad = entry.state === 'failed' || entry.state === 'blocked';
  const d =
    entry.kind === 'tool'
      ? 'M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-2z'
      : entry.kind === 'text'
        ? 'M5 7h14M5 12h14M5 17h9'
        : entry.kind === 'thought'
          ? 'M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3zM9.5 20.5h5'
          : entry.kind === 'answer'
            ? 'M4 5h16v11H10l-6 4z'
            : entry.state === 'finished'
              ? 'M5 12.5l4.5 4.5L19 7.5'
              : bad
                ? 'M12 7v6m0 3.5v.5'
                : 'M12 8v4l3 2';
  return (
    <svg className={`act-icon ${bad ? 'act-icon-bad' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t(`activity.kind.${entry.kind}`) })}>
      <path d={d} />
    </svg>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`act-chevron ${open ? 'act-chevron-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

interface Shared {
  /** Where the clock of the lines starts. */
  origin: number;
  nameOf: (role: string) => string;
}

/** A thought is one closed row: the word, and the masked text only once the person opened it. */
function ThoughtRow({ entry, origin }: { entry: ActivityEntry; origin: number }) {
  const t = useT();
  const [open, toggle] = useTreeOpen(`${entry.runId}:${entry.seq}`, false);
  return (
    <li className="act-step act-thought">
      <time className="act-time">{formatElapsed(entry.at - origin)}</time>
      <KindIcon entry={entry} decorative />
      <div className="act-label">
        <button type="button" className="act-thought-toggle" aria-expanded={open} onClick={toggle}>
          <Chevron open={open} />
          {t('activity.thought')}
        </button>
        {open && <p className="act-thought-text">{entry.label}</p>}
      </div>
    </li>
  );
}

function LineRow({ entry, origin }: { entry: ActivityEntry; origin: number }) {
  const t = useT();
  if (entry.kind === 'thought') return <ThoughtRow entry={entry} origin={origin} />;
  return (
    <li className={`act-step act-${entry.kind} ${entry.state === 'blocked' || entry.state === 'failed' ? 'act-bad' : ''}`}>
      <time className="act-time">{formatElapsed(entry.at - origin)}</time>
      <KindIcon entry={entry} />
      <span className="act-label">{stepText(entry, t('activity.thought'))}</span>
    </li>
  );
}

/** One level of the tree: a header that says what it is and how it stands, and, open, its own lines and the levels under it in the order they began. */
function NodeRow({ node, shared }: { node: TreeNode; shared: Shared }) {
  const t = useT();
  const [open, toggle] = useTreeOpen(node.id, defaultOpen(node));
  const title = nodeTitle(node, shared.nameOf);
  return (
    <li className={`act-node act-node-${node.type} act-state-${node.state}`}>
      <button type="button" className="act-node-head" aria-expanded={open} onClick={toggle}>
        <Chevron open={open} />
        {node.state === 'working' && <span className="spinner act-spinner" aria-hidden="true" />}
        <span className="act-node-title">{title}</span>
        <span className="act-node-state">{t(`activity.node.state.${node.state}`)}</span>
        {!open && waitsBelow(node) && <span className="act-node-waits">{t('activity.node.waitsBelow')}</span>}
        {!open && node.latest && <span className="act-node-now">{stepText(node.latest, t('activity.thought'))}</span>}
      </button>
      {open && <Items items={node.items} shared={shared} className="act-node-body" />}
    </li>
  );
}

function Items({ items, shared, className }: { items: readonly TreeItem[]; shared: Shared; className: string }) {
  return (
    <ol className={className}>
      {items.map((item) => (item.type === 'node' ? <NodeRow key={item.node.id} node={item.node} shared={shared} /> : <LineRow key={`${item.entry.runId}:${item.entry.seq}`} entry={item.entry} origin={shared.origin} />))}
    </ol>
  );
}

/** The nodes of a tree with their steps; follows the newest line unless the person scrolled up. */
export function ActivityTree({ nodes }: { nodes: readonly TreeNode[] }) {
  const t = useT();
  const team = useRunConfig()?.agents.team;
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const origin = nodes.length ? Math.min(...nodes.map((n) => n.since)) : 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [nodes]);

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

  const shared: Shared = { origin, nameOf: (role) => agentName(team, role) };
  return (
    <div className="act-tree-wrap">
      <div ref={box} className="act-tree" role="log" aria-label={t('activity.timeline')} onScroll={onScroll} tabIndex={0}>
        {nodes.length === 0 ? <p className="act-empty">{t('activity.empty')}</p> : <Items items={nodes.map((node) => ({ type: 'node' as const, node }))} shared={shared} className="act-nodes" />}
      </div>
      {away && (
        <button type="button" className="act-latest" onClick={jump}>
          {t('activity.latest')}
        </button>
      )}
    </div>
  );
}
