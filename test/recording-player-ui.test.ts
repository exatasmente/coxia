// The evidence block's player for the app's own screen recording: the Open button for a recording and not for one retention removed, the video that loads only on a
// click, the strip of marks, and the pure pieces under it. The player in motion (a mark seeking a real video) is for the manual plan.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceView } from '../src/shared/evidence';
import { messageText } from '../src/shared/forum';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { EvidenceBlock, EvidenceAttachment } = await import('../src/renderer/src/screens/cycle/Evidence');
const { RecordingPlayer } = await import('../src/renderer/src/screens/cycle/RecordingPlayer');
const { cutLeft, evidenceKey, keepSame, markBox } = await import('../src/renderer/src/screens/cycle/recording');

afterEach(() => setLanguage('pt-BR'));

const piece = (over: Partial<EvidenceView> = {}): EvidenceView => ({
  id: 'ev-1',
  stage: 'qa',
  by: 'qa',
  title: 'Screen recording of the stage (made by the app)',
  description: '',
  name: 'screen.webm',
  kind: 'webm',
  bytes: 400_000,
  at: '2026-10-08T10:00:00.000Z',
  from: null,
  message: 1,
  media: 'video/webm',
  recording: { durationMs: 60_000, width: 1280, height: 800, marks: [{ fromMs: 15_000, toMs: 30_000 }] },
  ...over,
});

const block = (list: EvidenceView[]): string => renderToStaticMarkup(createElement(EvidenceBlock, { runId: 'r-1', stage: 'qa', list }));

describe('a recording in the evidence block', () => {
  it('is listed with Open and Download, and loads no video until it is opened', () => {
    const html = block([piece()]);
    expect(html).toContain('WEBM');
    expect(html).toContain(`>${t('ui.cycle.evidenceBlock.open')}</button>`);
    expect(html).toContain(`>${t('ui.cycle.evidenceBlock.download')}</button>`);
    expect(html).not.toContain('<video');
    expect(html).not.toContain('blob:');
  });

  it('says it was removed by retention, in place of the video, with no Open and no Download', () => {
    const html = block([piece({ removed: 'retention' })]);
    expect(html).toContain(t('ui.cycle.rec.removed'));
    expect(html).not.toContain(`>${t('ui.cycle.evidenceBlock.open')}</button>`);
    expect(html).not.toContain(`>${t('ui.cycle.evidenceBlock.download')}</button>`);
    // The person can still delete the record.
    expect(html).toContain(`>${t('ui.cycle.evidenceBlock.remove')}</button>`);
  });

  it('keeps an image as it was: Open, and no recording text', () => {
    const html = block([piece({ id: 'ev-2', kind: 'png', media: 'image/png', recording: undefined, name: 'shot.png' })]);
    expect(html).toContain(`>${t('ui.cycle.evidenceBlock.open')}</button>`);
    expect(html).not.toContain(t('ui.cycle.rec.removed'));
  });
});

const player = (record: EvidenceView): string => renderToStaticMarkup(createElement(RecordingPlayer, { record, url: 'blob:x' }));

describe('the player', () => {
  it('is a video with controls and no preload, on the address it was given', () => {
    const html = player(piece());
    expect(html).toMatch(/<video[^>]*src="blob:x"/);
    expect(html).toContain('controls');
    expect(html).toContain('preload="none"');
    expect(html).toContain(t('ui.cycle.rec.duration', { time: '1:00' }));
  });

  it('draws one mark for each interval, at its place on the timeline, each a button that names the interval', () => {
    const html = player(piece({ recording: { durationMs: 60_000, width: 1280, height: 800, marks: [{ fromMs: 15_000, toMs: 30_000 }, { fromMs: 45_000, toMs: 46_000 }] } }));
    expect(html.match(/class="cy-rec-mark"/g)).toHaveLength(2);
    expect(html).toContain('left:25%;width:25%');
    expect(html).toContain(`aria-label="${t('ui.cycle.rec.mark', { from: '0:15', to: '0:30' })}"`);
    expect(html).toContain(t('ui.cycle.rec.marks'));
  });

  it('draws no strip for a recording nobody used, and says when a limit cut it short', () => {
    const plain = player(piece({ recording: { durationMs: 60_000, width: 1280, height: 800, marks: [] } }));
    expect(plain).not.toContain('cy-rec-mark');
    expect(plain).not.toContain(t('ui.cycle.rec.marks'));
    expect(player(piece({ recording: { durationMs: 60_000, width: 1280, height: 800, marks: [], truncated: 'size' } }))).toContain(t('ui.cycle.rec.truncatedSize'));
    expect(player(piece({ recording: { durationMs: 60_000, width: 1280, height: 800, marks: [], truncated: 'time' } }))).toContain(t('ui.cycle.rec.truncatedTime'));
  });
});

// #176: a video whose idle stretches were shortened says how long it is, how long the stage was, and where the cuts are.
describe('the player of a video with cuts', () => {
  const cut = (atMs: number, skippedMs: number) => ({ atMs, skippedMs });
  const withCuts = (cuts: ReturnType<typeof cut>[], over: Partial<NonNullable<EvidenceView['recording']>> = {}) =>
    piece({ recording: { durationMs: 60_000, realMs: 60_000 + cuts.reduce((n, c) => n + c.skippedMs, 0), width: 1280, height: 800, marks: [], cuts, ...over } });

  it('draws a tick for each cut at its place, each a button that says what it left out and the stage\'s time then', () => {
    const html = player(withCuts([cut(15_000, 300_000), cut(45_000, 240_000)]));
    expect(html.match(/class="cy-rec-cut"/g)).toHaveLength(2);
    expect(html).toContain('left:25%');
    expect(html).toContain('left:75%');
    expect(html).toContain(`aria-label="${t('ui.cycle.rec.cut', { at: '0:15', skipped: '5:00', real: '5:15' })}"`);
    expect(html).toContain(`aria-label="${t('ui.cycle.rec.cut', { at: '0:45', skipped: '4:00', real: '9:45' })}"`);
    expect(html).toContain(t('ui.cycle.rec.cuts'));
  });

  it('says the length of the video and the time the stage spent, and the stage\'s time at the start of it', () => {
    const html = player(withCuts([cut(15_000, 300_000), cut(45_000, 240_000)]));
    expect(html).toContain(t('ui.cycle.rec.durationReal', { time: '1:00', real: '10:00' }));
    expect(html).toContain(t('ui.cycle.rec.realTime', { time: '0:00' }));
  });

  it('draws no tick for the cut at the end of the video, and no strip when that is the only cut', () => {
    const html = player(withCuts([cut(60_000, 300_000)]));
    expect(html).not.toContain('cy-rec-cut');
    expect(html).not.toContain(t('ui.cycle.rec.cuts'));
    // The length of the video and the stage\'s time are still said.
    expect(html).toContain(t('ui.cycle.rec.durationReal', { time: '1:00', real: '6:00' }));
  });

  it('is as it was for a video nothing was cut from: no ticks, no stage time, the length alone', () => {
    const html = player(piece());
    expect(html).not.toContain('cy-rec-cut');
    expect(html).not.toContain(t('ui.cycle.rec.cuts'));
    expect(html).not.toContain(t('ui.cycle.rec.realTime', { time: '0:00' }));
    expect(html).toContain(t('ui.cycle.rec.duration', { time: '1:00' }));
  });

  it('keeps the marks on the video\'s clock beside the cuts', () => {
    const html = player(withCuts([cut(15_000, 300_000)], { marks: [{ fromMs: 30_000, toMs: 45_000 }] }));
    expect(html.match(/class="cy-rec-mark"/g)).toHaveLength(1);
    expect(html).toContain('left:50%;width:25%');
  });

  it.each(['en', 'pt-BR'] as const)('is worded in %s, with nothing left as a code or a hole', (language) => {
    setLanguage(language);
    for (const key of ['ui.cycle.rec.durationReal', 'ui.cycle.rec.realTime', 'ui.cycle.rec.cuts', 'ui.cycle.rec.cut'] as const) {
      expect(CATALOGS[language][key], key).toBeTruthy();
      expect(t(key, { time: 'T', real: 'R', at: 'A', skipped: 'S' }), key).not.toMatch(/\{\w+\}|ui\.cycle/);
    }
  });
});

describe('where a cut sits', () => {
  it('is a share of the video\'s length, and nothing at or past its end or for a video with no length', () => {
    expect(cutLeft(60_000, { atMs: 15_000, skippedMs: 1 })).toBe(25);
    expect(cutLeft(60_000, { atMs: 0, skippedMs: 1 })).toBe(0);
    expect(cutLeft(60_000, { atMs: 60_000, skippedMs: 1 })).toBeNull();
    expect(cutLeft(0, { atMs: 0, skippedMs: 1 })).toBeNull();
  });
});

describe('where a mark sits', () => {
  it('is a share of the recording, never off the strip, and wide enough to hit', () => {
    expect(markBox(100_000, { fromMs: 10_000, toMs: 30_000 })).toEqual({ left: 10, width: 20 });
    const click = markBox(100_000, { fromMs: 50_000, toMs: 50_000 });
    expect(click?.left).toBe(50);
    expect(click?.width).toBeGreaterThan(1);
    const end = markBox(100_000, { fromMs: 99_900, toMs: 140_000 });
    expect(end && end.left + end.width).toBeLessThanOrEqual(100);
  });

  it('is nothing for a recording with no length or an interval after its end or backwards', () => {
    expect(markBox(0, { fromMs: 0, toMs: 1000 })).toBeNull();
    expect(markBox(1000, { fromMs: 2000, toMs: 3000 })).toBeNull();
    expect(markBox(10_000, { fromMs: 5000, toMs: 1000 })).toBeNull();
  });
});

describe('when the evidence list is read again', () => {
  const ev = (id: string, removed = false) => ({ id, kind: 'png', ...(removed ? { removed: 'retention' as const } : {}) });

  it('changes when the run keeps a piece, loses one, or has one removed by retention', () => {
    const before = evidenceKey({ evidence: { 'ev-1': ev('ev-1') } } as never);
    expect(evidenceKey({ evidence: { 'ev-1': ev('ev-1'), 'ev-2': ev('ev-2') } } as never)).not.toBe(before);
    expect(evidenceKey({ evidence: {} } as never)).not.toBe(before);
    expect(evidenceKey({ evidence: { 'ev-1': ev('ev-1', true) } } as never)).not.toBe(before);
    expect(evidenceKey({ evidence: { 'ev-1': ev('ev-1') } } as never)).toBe(before);
    expect(evidenceKey(null)).toBe('');
    expect(evidenceKey({} as never)).toBe('');
  });

  it('keeps the records that did not change as the same objects, so an open recording is not read again', () => {
    const a = piece({ id: 'ev-1' });
    const b = piece({ id: 'ev-2' });
    const next = keepSame([a, b], [{ ...a }, { ...b, title: 'changed' }, piece({ id: 'ev-3' })]);
    expect(next?.[0]).toBe(a);
    expect(next?.[1]).not.toBe(b);
    expect(next?.map((e) => e.id)).toEqual(['ev-1', 'ev-2', 'ev-3']);
    expect(keepSame(undefined, [a])).toEqual([a]);
    expect(keepSame([a], null)).toBeNull();
  });
});

describe('the recording in the conversation', () => {
  const attachment = { id: 'ev-1', name: 'screen.webm', media: 'video/webm', bytes: 400_000 };

  it('is an attachment that opens on a click, never loading the video before', () => {
    const html = renderToStaticMarkup(createElement(EvidenceAttachment, { runId: 'r-1', attachment }));
    expect(html).toContain('screen.webm');
    expect(html).not.toContain('<video');
  });

  it.each(['en', 'pt-BR'] as const)('words what the app recorded and what an agent kept, in %s, never as a bare catalog code', (language) => {
    setLanguage(language);
    for (const code of ['runner.evidence.recorded', 'runner.evidence.kept']) {
      expect(CATALOGS[language][`main.forum.code.${code}`], code).toBeTruthy();
      const text = messageText({ code, params: { title: 'T', kind: 'png', description: '', id: 'ev-1', agent: 'qa' } });
      expect(text, code).not.toContain('main.forum.code');
      expect(text, code).not.toMatch(/\{\w+\}/);
    }
    expect(messageText({ code: 'runner.evidence.kept', params: { title: 'A shot', kind: 'png', description: '', id: 'ev-3' } })).toContain('ev-3');
  });
});
