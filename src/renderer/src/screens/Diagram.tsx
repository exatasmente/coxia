import mermaid from 'mermaid';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { diagramApi } from '../diagramApi';
import { useT } from '../i18n';
import { parseBlocks, parseInline, splitDiagrams } from '../richText';
import { ZoomViewer } from './ZoomViewer';

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
  return (
    <ZoomViewer title={title} onClose={onClose}>
      {(style) => <div className="diagram-svg diagram-svg-full" style={style} dangerouslySetInnerHTML={{ __html: svg }} />}
    </ZoomViewer>
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
