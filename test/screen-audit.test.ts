import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_AUDIT_KINDS, type AuditEntry } from '../src/shared/auditoria';
import { CATALOGS } from '../src/shared/i18n';
import { auditScreen, countsText, screenCloseEntry, screenConfirmEntry, screenHoldEntry, screenOpenEntry, screenUseEntry, siteOf } from '../src/main/browser/audit';
import { listAudit } from '../src/main/auditoria';

// What an agent's virtual screen writes to the audit log: the five kinds, their fields, and what they can never hold.

const who = { key: 'call:team-chat:scout', agent: 'scout', place: 'conversation' as const };

describe('the entries', () => {
  it('says how a screen opened: the path, the mode, the profile and the message that asked', () => {
    expect(screenOpenEntry({ ...who, mode: 'none', path: 'app-browser', profile: 'own', message: 12 })).toMatchObject({
      kind: 'screen-open',
      target: 'screen:call:team-chat:scout',
      via: 'none',
      issue: 0,
      by: 'scout',
      ok: true,
      origin: { actionId: '', kind: 'screen', key: 'call:team-chat:scout', summary: null },
      fields: { agent: 'scout', place: 'conversation', path: 'app-browser', profile: 'own', message: '12' },
    });
    const stage = screenOpenEntry({ key: 'run:r1', agent: 'qa', place: 'stage', issue: 101, mode: 'sandbox', path: 'both', profile: 'fresh' });
    expect(stage.issue).toBe(101);
    expect(stage.fields).not.toHaveProperty('message');
  });

  it('says how it closed: why, how long, the steps by tool, the hosts with counts and whether the recording was kept', () => {
    const e = screenCloseEntry({ ...who, mode: 'sandbox', reason: 'idle', ms: 601_234.6, steps: { browser_click: 3, browser_type: 7, browser_snapshot: 0 }, hostsAllowed: { 'app.example.com': 40 }, hostsRefused: { 'www.example.org': 2, 'ads.example.net': 5 }, recording: 'kept' });
    expect(e).toMatchObject({ kind: 'screen-close', via: 'sandbox', result: 'closed' });
    expect(e.fields).toEqual({ agent: 'scout', place: 'conversation', reason: 'idle', ms: '601235', recording: 'kept', steps: 'browser_type=7, browser_click=3', hostsAllowed: 'app.example.com=40', hostsRefused: 'ads.example.net=5, www.example.org=2' });
  });

  it('keeps the counts to what a field of the log holds, and says so when there are more', () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`host-${String(i).padStart(2, '0')}.example.com`, 60 - i]));
    const text = countsText(many);
    expect(text.length).toBeLessThanOrEqual(285);
    expect(text.endsWith(', …')).toBe(true);
    expect(text.startsWith('host-00.example.com=60, host-01.example.com=59')).toBe(true);
    expect(countsText({})).toBe('—');
    expect(countsText({ a: -1, b: Number.NaN })).toBe('—');
  });

  it('says which step was held, why, on which site, who answered and through what', () => {
    const yes = screenHoldEntry({ ...who, why: 'submit', step: "click 'Send', a submit button", site: 'https://app.example.com/sheet/abc?token=x#cell', agentWords: 'sending the weekly report', answer: 'yes', through: 'window' });
    expect(yes).toMatchObject({ kind: 'screen-hold', via: 'window', ok: true, result: 'let through' });
    expect(yes.fields).toEqual({ agent: 'scout', why: 'submit', step: "click 'Send', a submit button", site: 'app.example.com', agentWords: 'sending the weekly report', answer: 'yes', through: 'window' });
    const no = screenHoldEntry({ ...who, why: 'name', step: "click 'Delete'", site: 'app.example.com', answer: 'timeout', through: 'none' });
    expect(no).toMatchObject({ ok: false, result: 'not done', via: 'none' });
    expect(no.fields).not.toHaveProperty('agentWords');
    expect(screenHoldEntry({ ...who, why: 'unclassified', step: 'click at 10,20', site: 'app.example.com', answer: 'site', through: 'paired' }).ok).toBe(true);
  });

  it('says which confirmation the agent asked for and how it was answered', () => {
    const e = screenConfirmEntry({ ...who, kind: 'publish', words: 'publish the page', site: 'app.example.com/page', answer: 'no', through: 'paired' });
    expect(e).toMatchObject({ kind: 'screen-confirm', ok: false, via: 'paired', result: 'not approved' });
    expect(e.fields).toEqual({ agent: 'scout', confirmKind: 'publish', agentWords: 'publish the page', site: 'app.example.com', answer: 'no', through: 'paired' });
    expect(screenConfirmEntry({ ...who, kind: 'send', words: 'send it', answer: 'yes', through: 'window' }).fields).not.toHaveProperty('site');
  });

  it('says only when a person used the screen, from and to', () => {
    const e = screenUseEntry({ ...who, from: '2026-10-09T10:00:00.000Z', to: '2026-10-09T10:02:30.000Z' });
    expect(e).toMatchObject({ kind: 'screen-use', via: 'window' });
    expect(e.fields).toEqual({ agent: 'scout', from: '2026-10-09T10:00:00.000Z', to: '2026-10-09T10:02:30.000Z' });
  });
});

describe('what the log never holds', () => {
  it('reduces a site to its host: no path, query, fragment, port or credentials', () => {
    expect(siteOf('https://User:Pass@App.Example.com:8443/a/b?q=1#c')).toBe('app.example.com');
    expect(siteOf('app.example.com/a/b')).toBe('app.example.com');
    expect(siteOf('  ')).toBe('');
    expect(siteOf('http://')).toBe('');
  });

  it('has no field for a keystroke, a typed value, a cookie or page text: what the caller adds is dropped', () => {
    const hostile = { ...who, why: 'submit', step: 'click Send', site: 'app.example.com', answer: 'yes', through: 'window', typed: 'hunter2', keys: 'abc', cookie: 'sid=1', pageText: 'secret page', url: 'https://app.example.com/x?y=1' } as unknown as Parameters<typeof screenHoldEntry>[0];
    const e = screenHoldEntry(hostile);
    expect(JSON.stringify(e)).not.toMatch(/hunter2|abc|sid=1|secret page|\/x\?y=1/);
    expect(Object.keys(e.fields).sort()).toEqual(['agent', 'answer', 'site', 'step', 'through', 'why']);
  });

  it('scrubs a credential the agent or the page put in the words, and cuts a long step', () => {
    const e = screenHoldEntry({ ...who, why: 'name', step: `click 'Send' ${'x'.repeat(500)}`, site: 'app.example.com', agentWords: 'use Bearer abcdefghijklmnop1234 to send, mail ana@example.com', answer: 'no', through: 'window' });
    expect(e.fields.step.length).toBeLessThanOrEqual(200);
    expect(e.fields.agentWords).not.toContain('abcdefghijklmnop1234');
    expect(e.fields.agentWords).not.toContain('ana@example.com');
    expect(e.fields.step).not.toMatch(/\n/);
  });
});

describe('the log', () => {
  it('writes each kind as a line the audit screen lists, with the log\'s own scrubbing', () => {
    auditScreen.opened({ ...who, mode: 'sandbox', path: 'shell', profile: 'fresh' });
    auditScreen.closed({ ...who, mode: 'sandbox', reason: 'person', ms: 1000, steps: {}, hostsAllowed: {}, hostsRefused: {}, recording: 'not' });
    auditScreen.held({ ...who, why: 'submit', step: 'click Send with Authorization: Bearer abcdefghijklmnop1234', site: 'app.example.com', answer: 'yes', through: 'window' });
    auditScreen.confirmed({ ...who, kind: 'other', words: 'do it', answer: 'yes', through: 'window' });
    auditScreen.used({ ...who, from: '2026-10-09T10:00:00.000Z', to: '2026-10-09T10:01:00.000Z' });
    const rows = listAudit().filter((r) => r.origin.kind === 'screen');
    expect(rows.map((r) => r.kind).sort()).toEqual([...SCREEN_AUDIT_KINDS].sort());
    expect(JSON.stringify(rows)).not.toContain('abcdefghijklmnop1234');
    expect(rows.every((r) => r.by === 'scout' && r.origin.key === 'call:team-chat:scout')).toBe(true);
  });

  it('never throws, and hands the sink what it would write', () => {
    const seen: Omit<AuditEntry, 'at'>[] = [];
    auditScreen.used({ ...who, from: 'a', to: 'b' }, (e) => seen.push(e));
    expect(seen.map((e) => e.kind)).toEqual(['screen-use']);
  });
});

describe('the audit screen', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/Auditoria.tsx'), 'utf8');
  const keyOf = (kind: string): string => `ui.audit.kind.${kind.replace(/^screen-(\w)/, (_, c: string) => `screen${c.toUpperCase()}`)}`;

  it('names every screen kind, in both languages', () => {
    for (const kind of SCREEN_AUDIT_KINDS) {
      expect(source, kind).toContain(`'${kind}': { key: '${keyOf(kind)}' }`);
      for (const lang of ['pt-BR', 'en'] as const) expect(CATALOGS[lang][keyOf(kind)], `${lang} ${kind}`).toBeTruthy();
    }
  });
});
