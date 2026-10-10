// What the text of an SDK answer says about a busy model: only the refusals that move a call to the next model of its pool, never the key, never the budget.
import { describe, expect, it } from 'vitest';
import { busyText } from '../src/main/engine/budget';

describe('busyText', () => {
  it('reads the status the SDK puts after "API Error"', () => {
    expect(busyText('API Error: 429 {"error":{"message":"slow down"}}')).toBe('rate_limit');
    expect(busyText('API Error: 529 Overloaded')).toBe('overloaded');
    expect(busyText('API Error: 503 Service Unavailable')).toBe('overloaded');
    expect(busyText('API Error: 500 Internal Server Error')).toBe('server');
    expect(busyText('API Error: 502 Bad Gateway')).toBe('server');
  });

  it('reads the name the API gives the error when there is no status', () => {
    expect(busyText('{"type":"error","error":{"type":"rate_limit_error"}}')).toBe('rate_limit');
    expect(busyText('{"type":"error","error":{"type":"overloaded_error"}}')).toBe('overloaded');
  });

  it('is none of the errors that are not about a busy model', () => {
    expect(busyText('API Error: 400 invalid request')).toBeNull();
    expect(busyText('API Error: 404 model not found')).toBeNull();
    expect(busyText('API Error: 401 invalid api key')).toBeNull();
    expect(busyText('the gateway said hello')).toBeNull();
    expect(busyText('')).toBeNull();
  });

  it('leaves a refusal by budget to the budget', () => {
    expect(busyText('Failed to authenticate. API Error: 403 Key limit exceeded (monthly limit)')).toBeNull();
    expect(busyText('API Error: 429 monthly limit exceeded, add credit')).toBeNull();
    expect(busyText('API Error: 402 payment required')).toBeNull();
  });
});
