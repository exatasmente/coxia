import { describe, expect, it } from 'vitest';
import { clientFor } from '../src/main/engine/open/bridge';

// One client per server, model and key: what a server taught a client (rejected parameters, the reasoning echo) is about that server and that key.

describe('clientFor', () => {
  const at = (apiKey?: string, extra = {}) => ({ baseUrl: 'http://127.0.0.1:1/v1', model: 'model-x', apiKey, ...extra });

  it('shares a client between two calls with the same server, model and key', () => {
    expect(clientFor(at('key-one'))).toBe(clientFor(at('key-one')));
    expect(clientFor(at())).toBe(clientFor(at()));
  });

  it('gives two providers on one server and model, with different keys, a client each', () => {
    const one = clientFor(at('key-one'));
    const two = clientFor(at('key-two'));
    expect(two).not.toBe(one);
    expect(one.cfg.apiKey).toBe('key-one');
    expect(two.cfg.apiKey).toBe('key-two');
    expect(clientFor(at('key-one', { echoReasoning: true }))).not.toBe(one);
  });
});
