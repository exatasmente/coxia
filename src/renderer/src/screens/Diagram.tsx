import mermaid from 'mermaid';
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { diagramApi } from '../diagramApi';
import { useT } from '../i18n';
import { parseBlocks, parseInline, splitDiagrams } from '../richText';

function darkTheme(): boolean {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// Diagrams come from agents: strict mode sanitizes labels and blocks scripts and click handlers inside the SVG.
async function renderSvg(id: string, code: string): Promise<string> {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: darkTheme() ? 'dark' : 'default', fontFamily: 'IBM Plex Sans, system-ui, sans-serif' }); // i18n-ignore: font stack
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch (e) {
    // A failed render leaves its scratch container (and error graphic) in <body>.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    throw e;
  }
}

function cleanCode(code: string): string {
  return code.replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/** `repair` false: a diagram the app drew itself is never sent to a model to be fixed. */
export function Diagram({ code, title, repair = true }: { code: string; title?: string; repair?: boolean }) {
  const t = useT();
  const rawId = useId();
  const id = `d${rawId.replace(/[^\w]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const [fixing, setFixing] = useState(false);
  const [repaired, setRepaired] = useState(false);
  const fixedRef = useRef<{ from: string; to: string } | null>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const src = cleanCode(code);
    const known = fixedRef.current?.from === src ? fixedRef.current.to : null;
    const short = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));
    setError(null);
    (async () => {
      let first: unknown;
      try {
        const s = await renderSvg(`${id}-${themeTick}`, known ?? src);
        if (alive) {
          setSvg(s);
          setRepaired(known !== null);
        }
        return;
      } catch (e) {
        first = e;
      }
      if (known !== null || !alive || !repair) {
        if (alive) setError(short(first));
        return;
      }
      setSvg(null);
      setFixing(true);
      try {
        const to = await diagramApi.fix(src, first instanceof Error ? first.message : String(first));
        const s = await renderSvg(`${id}-${themeTick}-fix`, to);
        fixedRef.current = { from: src, to };
        if (alive) {
          setSvg(s);
          setRepaired(true);
        }
      } catch {
        if (alive) setError(short(first));
      } finally {
        if (alive) setFixing(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, id, themeTick, repair]);

  if (error) {
    return (
      <div className="diagram diagram-error">
        <span className="small">{t('ui.diagram.failed', { error })}</span>
        <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{cleanCode(code)}</pre>
      </div>
    );
  }

  return (
    <>
      <figure className="diagram">
        <button type="button" className="btn diagram-expand" aria-label={t('ui.diagram.expandAria')} title={t('ui.diagram.expand')} onClick={() => setFull(true)} disabled={!svg}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
        {svg ? (
          <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} onDoubleClick={() => setFull(true)} />
        ) : (
          <div className="row faint"><span className="spinner" /> {fixing ? t('ui.diagram.fixing') : t('ui.diagram.drawing')}</div>
        )}
        {(title || repaired) && <figcaption className="small muted">{[title, repaired && t('ui.diagram.repaired')].filter(Boolean).join(' · ')}</figcaption>}
      </figure>
      {full && svg && <DiagramViewer svg={svg} title={title} onClose={() => setFull(false)} />}
    </>
  );
}

function DiagramViewer({ svg, title, onClose }: { svg: string; title?: string; onClose: () => void }) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const zoom = useCallback((f: number) => setScale((s) => Math.min(6, Math.max(0.3, s * f))), []);
  const reset = useCallback(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoom(1.2);
      else if (e.key === '-') zoom(1 / 1.2);
      else if (e.key === '0') reset();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, zoom, reset]);

  const transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`; // i18n-ignore: CSS value

  return (
    <div className="diagram-overlay" role="dialog" aria-modal="true" aria-label={title ?? t('ui.diagram.fullscreen')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="diagram-toolbar">
        <span className="small" style={{ flex: '1 1 auto', fontWeight: 600 }}>{title ?? t('ui.diagram.title')}</span>
        <button type="button" className="btn" onClick={() => zoom(1 / 1.2)} aria-label={t('ui.diagram.zoomOut')}>−</button>
        <span className="mono small" style={{ minWidth: 48, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
        <button type="button" className="btn" onClick={() => zoom(1.2)} aria-label={t('ui.diagram.zoomIn')}>+</button>
        <button type="button" className="btn" onClick={reset}>{t('ui.diagram.fit')}</button>
        <button ref={closeRef} type="button" className="btn btn-dark" onClick={onClose}>{t('ui.diagram.close')}</button>
      </div>
      <div
        className="diagram-stage"
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          drag.current = touches.current.size === 1 ? { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y } : null;
          pinch.current = null;
        }}
        onPointerMove={(e) => {
          if (!touches.current.has(e.pointerId)) return;
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current) zoom(d / pinch.current);
            pinch.current = d;
          } else if (drag.current) {
            setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
          }
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId);
          drag.current = null;
          pinch.current = null;
        }}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId);
          drag.current = null;
          pinch.current = null;
        }}
      >
        <div className="diagram-svg diagram-svg-full" style={{ transform }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <p className="small diagram-hint">{t('ui.diagram.hint')}</p>
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.kind === 'code' ? <code key={i} className="mono rich-code">{s.value}</code> : s.kind === 'bold' ? <strong key={i}>{s.value}</strong> : <Fragment key={i}>{s.value}</Fragment>,
      )}
    </>
  );
}

function Blocks({ text }: { text: string }) {
  return (
    <div className="rich">
      {parseBlocks(text).map((b, i) =>
        b.kind === 'ul' ? (
          <ul key={i}>{b.lines.map((l, j) => <li key={j}><Inline text={l} /></li>)}</ul>
        ) : b.kind === 'ol' ? (
          <ol key={i} start={b.start}>{b.lines.map((l, j) => <li key={j}><Inline text={l} /></li>)}</ol>
        ) : b.kind === 'pre' ? (
          <pre key={i} className="mono rich-pre">{b.lines.join('\n')}</pre>
        ) : b.kind === 'h' ? (
          <p key={i} className="rich-h"><Inline text={b.lines[0]} /></p>
        ) : (
          <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} /></Fragment>)}</p>
        ),
      )}
    </div>
  );
}

// Chat text with ```mermaid blocks drawn as diagrams.
export function RichText({ text }: { text: string }) {
  return (
    <>
      {splitDiagrams(text).map((p, i) => (
        <Fragment key={i}>{p.kind === 'diagram' ? <Diagram code={p.value} /> : p.value.trim() && <Blocks text={p.value.trim()} />}</Fragment>
      ))}
    </>
  );
}
