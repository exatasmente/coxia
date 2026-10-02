import { useEffect, useRef, useState } from 'react';
import type { Screen } from './App';
import { api } from './api';
import { appInView, systemNotify } from './jobNotify';
import { type Job, formatElapsed, notificationText, sameScreen } from './jobs';
import { jobs, useJobsSnapshot } from './useJobs';
import './jobs.css';

// A job younger than this is not worth a button: most answers come back at once.
const SHOW_AFTER_MS = 700;
const TOAST_MS = 10_000;
const FAB = 52;
const GAP = 12;
const AVOID = '.composer, .composer-panel, .outbox-item';
export const JOBS_OPEN = 'cerimonias:jobs-open';

interface Toast {
  id: number;
  title: string;
  failed: boolean;
  screen: Screen;
}

function useFabLift(active: boolean): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let covered = 0;
      for (const el of document.querySelectorAll(AVOID)) {
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.bottom <= 0 || r.top >= vh || r.right < vw - FAB - GAP * 2) continue;
        covered = Math.max(covered, vh - r.top);
      }
      setLift(covered ? Math.round(covered + GAP) : 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    const watch = () => {
      resize.disconnect();
      for (const el of document.querySelectorAll(AVOID)) resize.observe(el);
      schedule();
    };
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    watch();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
    };
  }, [active]);
  return lift;
}

function Icon({ kind }: { kind: 'check' | 'alert' | 'close' }) {
  const d = kind === 'check' ? 'M5 12.5l4.5 4.5L19 7.5' : kind === 'alert' ? 'M12 7v6m0 3.5v.5' : 'M6 6l12 12M18 6L6 18';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function status(j: Job<Screen>, now: number): string {
  if (j.status === 'running') return `em andamento · ${formatElapsed(now - j.startedAt)}`;
  const took = formatElapsed((j.finishedAt ?? now) - j.startedAt);
  const ago = Math.max(0, Math.floor((now - (j.finishedAt ?? now)) / 60_000));
  const when = ago < 1 ? 'agora' : `há ${ago} min`;
  return j.status === 'done' ? `pronto ${when} · levou ${took}` : `falhou ${when} · levou ${took}`;
}

// Floating button with the agent jobs still running or not yet looked at, a panel to jump to them, and the completion notices.
export function JobsDock({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const snap = useJobsSnapshot();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announce, setAnnounce] = useState('');
  const fab = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const toastId = useRef(0);
  const here = useRef(screen);
  here.current = screen;

  // Finished jobs on the screen that is open are picked up by that screen at once; they are not news.
  const clock = Date.now();
  const shown = snap.filter((j) => (j.status === 'running' ? clock - j.startedAt >= SHOW_AFTER_MS : !sameScreen(j.screen as Screen, screen)));
  const running = shown.filter((j) => j.status === 'running').length;
  const failed = shown.filter((j) => j.status === 'failed').length;
  const lift = useFabLift(shown.length > 0);

  // A young running job shows up once it has lasted; the clock also ticks while the panel is open.
  const young = snap.filter((j) => j.status === 'running' && clock - j.startedAt < SHOW_AFTER_MS);
  useEffect(() => {
    const wait = young.length ? Math.min(...young.map((j) => SHOW_AFTER_MS - (Date.now() - j.startedAt))) : null;
    const timer = wait === null ? null : setTimeout(() => setNow(Date.now()), Math.max(50, wait));
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [young.length, snap]);
  useEffect(() => {
    const t = setInterval(() => jobs.sweep(), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = setInterval(() => {
      jobs.sweep();
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      const back = opener.current?.isConnected ? opener.current : fab.current;
      back?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!layer.current?.contains(target) && !target.closest('[aria-label="Execuções"]')) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // A notice about the screen the person just reached is no longer news.
  useEffect(() => {
    setToasts((t) => (t.some((x) => sameScreen(x.screen, screen)) ? t.filter((x) => !sameScreen(x.screen, screen)) : t));
  }, [screen]);

  // The bell in the top bar of Hoje opens the same panel, even when there is nothing to show yet.
  useEffect(() => {
    const onOpen = () => {
      opener.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    window.addEventListener(JOBS_OPEN, onOpen);
    return () => window.removeEventListener(JOBS_OPEN, onOpen);
  }, []);

  // Completion: a toast when the person is somewhere else in the app, a system notification when the window is out of sight.
  useEffect(
    () =>
      jobs.onFinish((job) => {
        const { title } = notificationText(job);
        setAnnounce(title);
        void (async () => {
          const settings = await api.getSettings().catch(() => null);
          if (settings && !settings.notifications) return;
          if (!sameScreen(job.screen as Screen, here.current)) {
            const id = ++toastId.current;
            setToasts((t) => [...t.slice(-2), { id, title, failed: job.status === 'failed', screen: job.screen }]);
            setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
          }
          if (!appInView()) await systemNotify(job).catch(() => undefined);
        })();
      }),
    [],
  );

  const openJob = (target: Screen) => {
    setOpen(false);
    setToasts((t) => t.filter((x) => x.screen !== target));
    go(target);
  };

  const label = shown.length
    ? `Tarefas do agente: ${running ? `${running} em andamento` : ''}${running && shown.length > running ? ', ' : ''}${shown.length > running ? `${shown.length - running} para ver` : ''}`
    : '';

  return (
    <div className="jobs-layer" ref={layer} style={{ bottom: `calc(var(--bottom-nav-h, env(safe-area-inset-bottom, 0px)) + 16px + ${lift}px)` }}>
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      <div className="jobs-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`jobs-toast ${t.failed ? 'jobs-toast-fail' : ''}`}>
            <span className="jobs-toast-text">{t.title} — <button type="button" className="jobs-link" onClick={() => openJob(t.screen)}>abrir</button></span>
            <button type="button" className="jobs-x" aria-label="Dispensar aviso" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}><Icon kind="close" /></button>
          </div>
        ))}
      </div>
      {open && (
        <section id="jobs-panel" className="jobs-panel" aria-label="Tarefas do agente" style={{ maxHeight: Math.max(160, window.innerHeight - lift - FAB - 96) }}>
          <header className="jobs-panel-head">
            <h2>Tarefas do agente</h2>
            {shown.some((j) => j.status !== 'running') && (
              <button type="button" className="jobs-link" onClick={() => jobs.clearFinished()}>Limpar concluídas</button>
            )}
          </header>
          {!shown.length && <p className="jobs-empty">Nenhuma execução em andamento nem para ver.</p>}
          <ul>
            {shown.map((j) => (
              <li key={j.key} className={`jobs-item jobs-${j.status}`}>
                <button type="button" className="jobs-item-main" onClick={() => openJob(j.screen)}>
                  <span className="jobs-item-label">
                    {j.status === 'running' && <span className="spinner" aria-hidden="true" />}
                    {j.label}
                  </span>
                  <span className="jobs-item-sub">{status(j, now)}</span>
                  {j.status === 'failed' && j.error && <span className="jobs-item-error">{j.error}</span>}
                </button>
                {j.status !== 'running' && (
                  <button type="button" className="jobs-x" aria-label={`Limpar ${j.label}`} onClick={() => jobs.dismiss(j.key)}><Icon kind="close" /></button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {shown.length > 0 && (
        <button
          ref={fab}
          type="button"
          className={`jobs-fab ${failed ? 'jobs-fab-fail' : ''}`}
          aria-label={label}
          aria-expanded={open}
          aria-controls="jobs-panel"
          onClick={() => {
            opener.current = fab.current;
            setOpen((o) => !o);
          }}
        >
          {running ? <span className="spinner" aria-hidden="true" /> : <Icon kind={failed ? 'alert' : 'check'} />}
          <span className="jobs-badge" aria-hidden="true">{shown.length}</span>
        </button>
      )}
    </div>
  );
}
