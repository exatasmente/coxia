// The full screen viewer the diagrams and the images of evidence share: a static render shows the dialog a person gets and that the content is drawn with the
// viewer's transform, whatever the content is.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../src/shared/i18n';

vi.hoisted(() => {
  // The renderer's translator module reads window.api and asks document whether the screen runs in a paired browser; node has neither.
  (globalThis as unknown as { window: unknown }).window = { api: {}, addEventListener: () => undefined };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
// useT subscribes with useSyncExternalStore, which has no server snapshot: a static render reads the translator directly.
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { ZoomViewer } = await import('../src/renderer/src/screens/ZoomViewer');

beforeAll(() => setLanguage('en'));

const render = (title?: string): string =>
  renderToStaticMarkup(
    createElement(ZoomViewer, { title, onClose: () => undefined, children: (style) => createElement('img', { className: 'cy-evidence-full', style, src: 'data:image/png;base64,AA==', alt: title }) }),
  );

describe('the full screen viewer', () => {
  it('is a modal dialog named after what it shows, with zoom, fit and close', () => {
    const html = render('Runs screen opening the seeded run');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Runs screen opening the seeded run"');
    expect(html).toContain(t('ui.diagram.zoomIn'));
    expect(html).toContain(t('ui.diagram.fit'));
    expect(html).toContain(t('ui.diagram.close'));
  });

  it('draws the content it is given with its transform, starting unzoomed', () => {
    const html = render('ev-1');
    expect(html).toMatch(/<img class="cy-evidence-full" style="transform:translate\(0px, 0px\) scale\(1\)" src="data:image\/png;base64,AA=="/);
  });

  it('falls back to a generic name when it is given none', () => {
    expect(render()).toContain(`aria-label="${t('ui.diagram.fullscreen')}"`);
  });
});
