import { describe, expect, it } from 'vitest';
import { mapHttpError } from '../src/main/engine/open/errors';
import { DEFAULT_REST_MS, MAX_REST_MS, createRestRegistry, restFor, restKey } from '../src/main/engine/open/rest';

const ctx = { lang: 'en' as const, model: 'model-a', host: 'example.com' };
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('the rest of a busy model', () => {
  it('rests for the default when the server says nothing, and comes back after it', () => {
    let t = 1_000;
    const reg = createRestRegistry(() => t);
    const back = reg.rest('k');
    expect(back).toBe(1_000 + DEFAULT_REST_MS);
    expect(DEFAULT_REST_MS).toBe(5 * 60_000);
    expect(reg.resting('k')).toBe(true);
    expect(reg.until('k')).toBe(back);
    t = back - 1;
    expect(reg.resting('k')).toBe(true);
    t = back;
    expect(reg.resting('k')).toBe(false);
    expect(reg.until('k')).toBeNull();
  });

  it('rests by the Retry-After of the server, capped at 15 minutes', () => {
    const reg = createRestRegistry(() => 0);
    expect(reg.rest('a', 90_000)).toBe(90_000);
    expect(reg.rest('b', 3_600_000)).toBe(MAX_REST_MS);
    expect(MAX_REST_MS).toBe(15 * 60_000);
  });

  it('a Retry-After of zero or an unreadable one says nothing: the default applies', () => {
    expect(restFor(0)).toBe(DEFAULT_REST_MS);
    expect(restFor(-5)).toBe(DEFAULT_REST_MS);
    expect(restFor(Number.NaN)).toBe(DEFAULT_REST_MS);
    expect(restFor(undefined)).toBe(DEFAULT_REST_MS);
    expect(restFor(1000)).toBe(1000);
  });

  it('keeps the longer of two rests and leaves other models alone', () => {
    const reg = createRestRegistry(() => 0);
    reg.rest('a', 600_000);
    expect(reg.rest('a', 1000)).toBe(600_000);
    expect(reg.resting('b')).toBe(false);
    reg.clear();
    expect(reg.resting('a')).toBe(false);
  });

  it('is told apart by server, model and key', () => {
    const k = restKey({ baseUrl: 'https://example.com/v1/', model: 'model-a', secretRef: 'llm.one' });
    expect(k).toBe(restKey({ baseUrl: 'https://example.com/v1', model: 'model-a', secretRef: 'llm.one' }));
    expect(k).not.toBe(restKey({ baseUrl: 'https://example.com/v1', model: 'model-b', secretRef: 'llm.one' }));
    expect(k).not.toBe(restKey({ baseUrl: 'https://example.com/v1', model: 'model-a', secretRef: 'llm.two' }));
    expect(k).not.toBe(restKey({ baseUrl: 'https://example.org/v1', model: 'model-a', secretRef: 'llm.one' }));
    expect(restKey({ baseUrl: 'http://localhost:11434/v1', model: 'm' })).toBe(restKey({ baseUrl: 'http://localhost:11434/v1', model: 'm', secretRef: null }));
  });
});

describe('the rest an error asks for', () => {
  it('carries the Retry-After uncapped by the one-call sleep (60 s) and capped at 15 minutes', () => {
    const e = mapHttpError(429, '{"error":{"message":"slow down"}}', headers({ 'retry-after': '600' }), ctx);
    expect(e.kind).toBe('rate_limit');
    expect(e.retryAfterMs).toBe(60_000);
    expect(e.restMs).toBe(600_000);
    expect(mapHttpError(503, 'busy', headers({ 'retry-after': '99999' }), ctx).restMs).toBe(MAX_REST_MS);
    expect(mapHttpError(529, 'busy', headers({ 'retry-after': '30' }), ctx)).toMatchObject({ kind: 'overloaded', retryAfterMs: 30_000, restMs: 30_000 });
    expect(mapHttpError(502, 'bad gateway', headers({ 'retry-after': '20' }), ctx)).toMatchObject({ kind: 'server', restMs: 20_000 });
  });

  it('reads engine_overloaded on a 429 as an overloaded model: a minute unless a Retry-After says more, and not a rate limit', () => {
    const body = '{"error":{"message":"Model is busy","code":"engine_overloaded"}}';
    expect(mapHttpError(429, body, headers({}), ctx)).toMatchObject({ kind: 'overloaded', status: 429, retryable: true, restMs: 60_000 });
    expect(mapHttpError(429, body, headers({ 'retry-after': '120' }), ctx).restMs).toBe(120_000);
    expect(mapHttpError(429, '{"error":{"message":"slow down","code":"rate_limit_exceeded"}}', headers({}), ctx)).toMatchObject({ kind: 'rate_limit', restMs: undefined });
  });

  it('reads a date, and has none without the header', () => {
    const at = new Date(Date.now() + 120_000).toUTCString();
    const e = mapHttpError(429, 'x', headers({ 'retry-after': at }), ctx);
    expect(e.restMs).toBeGreaterThan(100_000);
    expect(e.restMs).toBeLessThanOrEqual(120_000);
    expect(mapHttpError(429, 'x', headers({}), ctx).restMs).toBeUndefined();
  });
});
