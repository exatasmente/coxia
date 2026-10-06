import { useEffect, useState } from 'react';
import type { DocsConfig } from '../../../shared/config/types';
import { DOCS_KEYS, type DocsKey } from '../../../shared/wizard';
import { errorText } from '../api';
import { useT } from '../i18n';
import { Field } from './ui';
import { wizardApi } from './wizardApi';

const MCP_PLACEHOLDER = '~/project/.mcp.json'; // i18n-ignore: example path
const SKILLS_PLACEHOLDER = '~/project/.claude/skills'; // i18n-ignore: example path

interface Props {
  docs: Pick<DocsConfig, DocsKey>;
  onAdd: (key: DocsKey, path: string) => void;
  onRemove: (key: DocsKey, path: string) => void;
  /** What a scan found and is not listed yet (the wizard's), with an "add" button each. */
  proposals?: (key: DocsKey) => string[];
  /** A label for a listed path that deserves one (Settings marks the ones that are Claude Code's own). */
  badge?: (key: DocsKey, path: string) => string | null;
  onError: (message: string | null) => void;
}

// The lists of extra sources the person adds on purpose: the setup wizard and Settings › Documentation edit the same ones, so this is the one place that draws them.
export function DocsSourceLists({ docs, onAdd, onRemove, proposals = () => [], badge, onError }: Props) {
  const t = useT();
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  const configured = DOCS_KEYS.flatMap((k) => docs[k]);
  const all = [...new Set([...configured, ...DOCS_KEYS.flatMap((k) => proposals(k))])];
  const key = all.join('\n');
  useEffect(() => {
    if (!all.length) return;
    void wizardApi.pathsExist(all).then((flags) => setExists(Object.fromEntries(all.map((p, i) => [p, flags[i]]))), () => undefined);
  }, [key]);

  const pick = async (k: DocsKey) => {
    onError(null);
    try {
      const picked = await wizardApi.pickPath(k === 'mcpConfigFiles' ? 'file' : 'dir', t(`wizard.docs.${k}`));
      if (picked) onAdd(k, picked.path);
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <>
      {DOCS_KEYS.map((k) => (
        <section key={k} className="wz-stack wz-group" aria-labelledby={`docs-${k}`}>
          <div>
            <h3 id={`docs-${k}`} className="wz-sub">{t(`wizard.docs.${k}`)}</h3>
            <p className="small muted">{t(`wizard.docs.${k}.hint`)}</p>
          </div>
          {docs[k].length === 0 && proposals(k).length === 0 && <p className="small muted">{t('wizard.docs.empty')}</p>}
          <ul className="wz-cards">
            {docs[k].map((p) => {
              const label = badge?.(k, p);
              return (
                <li key={p} className="wz-card-item wz-row-between">
                  <span className="mono small wz-wrap-anywhere">
                    {p}
                    {exists[p] === false && <span className="badge badge-block" style={{ marginLeft: 8 }}>{t('wizard.docs.missing')}</span>}
                    {label && <span className="badge badge-ask" style={{ marginLeft: 8 }}>{label}</span>}
                  </span>
                  <button type="button" className="btn" aria-label={t('wizard.docs.remove', { path: p })} onClick={() => onRemove(k, p)}>{t('wizard.models.remove')}</button>
                </li>
              );
            })}
            {proposals(k).map((p) => (
              <li key={`found-${p}`} className="wz-card-item wz-row-between wz-found">
                <span className="mono small wz-wrap-anywhere"><span className="badge badge-ask" style={{ marginRight: 8 }}>{t('wizard.docs.found')}</span>{p}</span>
                <button type="button" className="btn" aria-label={t('wizard.docs.addPath', { path: p })} onClick={() => onAdd(k, p)}>{t('wizard.docs.add')}</button>
              </li>
            ))}
          </ul>
          <form className="wz-inline" onSubmit={(e) => { e.preventDefault(); onAdd(k, typed[k] ?? ''); setTyped((all) => ({ ...all, [k]: '' })); }}>
            <Field label={t('wizard.docs.typed')} htmlFor={`docs-in-${k}`}>
              <input id={`docs-in-${k}`} className="text-input mono" spellCheck={false} placeholder={k === 'mcpConfigFiles' ? MCP_PLACEHOLDER : SKILLS_PLACEHOLDER} value={typed[k] ?? ''} onChange={(e) => setTyped((all) => ({ ...all, [k]: e.target.value }))} />
            </Field>
            <div className="wz-actions">
              <button type="submit" className="btn" disabled={!(typed[k] ?? '').trim()}>{t('wizard.docs.add')}</button>
              <button type="button" className="btn" onClick={() => void pick(k)}>{t('wizard.docs.pick')}</button>
            </div>
          </form>
        </section>
      ))}
    </>
  );
}
