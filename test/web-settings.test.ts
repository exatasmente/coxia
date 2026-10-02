import { describe, expect, it } from 'vitest';
import { getSettings, saveSettings, saveWebSettings, validateWeb } from '../src/main/config';
import { DEFAULT_SETTINGS, withDefaults } from '../src/shared/settings';

describe('web settings', () => {
  it('is off by default and aims at the Docker gateway and the public tunnel', () => {
    const w = withDefaults(null).web;
    expect(w).toMatchObject({ enabled: false, host: '172.18.0.1', port: 4330, basePath: '/cerimonias/', publicUrl: 'https://koala.fortics.dev/cerimonias/', trustedProxy: '172.18.0.0/16', allowExternalEffects: false });
  });

  it('validates host, port, base path and public url', () => {
    const ok = DEFAULT_SETTINGS.web;
    expect(validateWeb({ ...ok, host: '127.0.0.1', port: 4331 }).port).toBe(4331);
    expect(() => validateWeb({ ...ok, host: 'evil.example' })).toThrow();
    expect(() => validateWeb({ ...ok, port: 80 })).toThrow();
    expect(() => validateWeb({ ...ok, port: 70000 })).toThrow();
    expect(() => validateWeb({ ...ok, basePath: 'cerimonias' })).toThrow();
    expect(() => validateWeb({ ...ok, basePath: '/../x/' })).toThrow();
    expect(() => validateWeb({ ...ok, publicUrl: 'http://example.com/' })).toThrow();
    expect(() => validateWeb({ ...ok, trustedProxy: '172.18.0.0' })).toThrow();
    expect(() => validateWeb({ ...ok, trustedProxy: '172.18.0.0/40' })).toThrow();
    expect(() => validateWeb({ ...ok, trustedProxy: '300.1.1.1/8' })).toThrow();
    expect(validateWeb({ ...ok, trustedProxy: '10.0.0.0/8' }).trustedProxy).toBe('10.0.0.0/8');
    expect(() => validateWeb({ ...ok, publicUrl: 'not a url' })).toThrow();
    expect(validateWeb({ ...ok, publicUrl: 'http://localhost:4331/cerimonias/' }).publicUrl).toContain('localhost');
  });

  it('a regular settings save never changes the web fields (browser clients cannot reach them)', () => {
    const before = saveWebSettings({ ...DEFAULT_SETTINGS.web, enabled: true, port: 4999 });
    expect(before.web.port).toBe(4999);
    const after = saveSettings({ ...getSettings(), web: { ...DEFAULT_SETTINGS.web, enabled: false, allowExternalEffects: true, port: 1234 } });
    expect(after.web).toEqual(before.web);
    expect(getSettings().web.allowExternalEffects).toBe(false);
  });
});
