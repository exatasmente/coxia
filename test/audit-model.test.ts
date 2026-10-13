// The decisions of the Audit screen above its markup (#248): who an entry belongs to, the filters, the link from the chat to an act, and the folded "what it had read".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { approvedOwn, basisLines, basisSummary, doorWords, filterEntries, indexOfAct, isWhoFilter, whoOf, WHO_FILTERS } from '../src/renderer/src/auditModel';
import en from '../src/shared/i18n/ui-today.en.json';
import ptBR from '../src/shared/i18n/ui-today.pt-BR.json';

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({ at: '2026-10-11T10:00:00Z', kind: 'sync', issue: 7, target: 'POST /x', via: 'test', fields: {}, ok: true, code: null, result: '', origin: { actionId: '', kind: 'k', key: 'k', summary: null }, ...over });

describe('who an entry belongs to', () => {
  it('reads a line with no actor as a person, as every line written before does', () => {
    expect(whoOf(entry())).toBe('person');
    expect(whoOf(entry({ actor: 'persona' }))).toBe('persona');
  });

  it('does not read an autonomous agent\'s write as the person\'s: `by` with no actor is an agent', () => {
    expect(whoOf(entry({ by: 'developer' }))).toBe('agent');
    // the persona stamps its own lines, whatever else they carry
    expect(whoOf(entry({ actor: 'persona', by: 'developer' }))).toBe('persona');
    const rows = [entry({ issue: 101 }), entry({ issue: 101, by: 'developer' }), entry({ issue: 101, actor: 'persona' })];
    expect(filterEntries(rows, { issue: '', who: 'person' })).toEqual([rows[0]]);
    expect(filterEntries(rows, { issue: '', who: 'agent' })).toEqual([rows[1]]);
  });

  it('reads the person\'s decision on a held step or change of policy as the person\'s', () => {
    expect(whoOf(entry({ kind: 'decision', by: 'person' }))).toBe('person');
    expect(whoOf(entry({ kind: 'policy-change', by: 'person' }))).toBe('person');
    expect(whoOf(entry({ kind: 'decision', by: 'persona' }))).toBe('persona');
  });

  it('filters by who and by issue together, and lets everything through when asked for all', () => {
    const rows = [entry({ issue: 101 }), entry({ issue: 101, actor: 'persona' }), entry({ issue: 202, actor: 'persona' })];
    expect(filterEntries(rows, { issue: '', who: 'all' })).toHaveLength(3);
    expect(filterEntries(rows, { issue: '', who: 'persona' })).toHaveLength(2);
    expect(filterEntries(rows, { issue: '', who: 'person' })).toHaveLength(1);
    expect(filterEntries(rows, { issue: '#101', who: 'persona' })).toEqual([rows[1]]);
  });

  it('knows the four filters and nothing else', () => {
    expect([...WHO_FILTERS]).toEqual(['all', 'person', 'persona', 'agent']);
    expect(isWhoFilter('persona')).toBe(true);
    expect(isWhoFilter('agent')).toBe(true);
    expect(isWhoFilter('robot')).toBe(false);
    expect(isWhoFilter(undefined)).toBe(false);
  });
});

describe('the link from the chat', () => {
  it('finds the first entry of an act in the list, and says nothing was found for an act older than the list or no act', () => {
    const rows = [entry({ id: 'a-2' }), entry({ id: 'a-1', kind: 'push' }), entry({ id: 'a-1' })];
    expect(indexOfAct(rows, 'a-1')).toBe(1);
    expect(indexOfAct(rows, 'a-0')).toBe(-1);
    expect(indexOfAct(rows, undefined)).toBe(-1);
    expect(indexOfAct([], 'a-1')).toBe(-1);
  });
});

describe('what a persona line shows', () => {
  it('words the known doors by a catalog key and shows any other as it is', () => {
    expect(doorWords('window')).toEqual({ key: 'ui.audit.door.window' });
    expect(doorWords('paired')).toEqual({ key: 'ui.audit.door.paired' });
    expect(doorWords('terminal')).toEqual({ key: 'ui.audit.door.terminal' });
    expect(doorWords('admin')).toEqual({ key: 'ui.audit.door.admin' });
    expect(doorWords('schedule')).toEqual({ raw: 'schedule' });
    expect(doorWords(undefined)).toBeNull();
  });

  it('says it approved its own proposal only when the persona both proposed and approved', () => {
    expect(approvedOwn({ actor: 'persona', proposedBy: 'persona' })).toBe(true);
    expect(approvedOwn({ actor: 'persona' })).toBe(false);
    expect(approvedOwn({ proposedBy: 'persona' })).toBe(false);
  });

  it('folds the subject, each read and the message, and has nothing for a line without a basis', () => {
    expect(basisLines(entry())).toBeNull();
    const lines = basisLines(entry({ basis: { subject: 'Approve the push', reads: [{ tool: 'Runs', op: 'get', target: 'run-1', excerpt: 'green' }, { tool: 'Board', op: 'list', target: 'all', excerpt: '' }], message: 12 } }));
    expect(lines).toEqual({ subject: 'Approve the push', reads: ['Runs.get run-1: green', 'Board.list all'], message: 12 });
  });
});

describe('the fold of an entry', () => {
  const read = { tool: 'Runs', op: 'get', target: 'run-1', excerpt: 'green' };

  it('is "what it had read" only when it read something, "what it decided on" when only the subject exists, and no fold when neither does', () => {
    expect(basisSummary(basisLines(entry({ basis: { subject: 'Approve the push', reads: [read], message: 12 } })))).toBe('ui.audit.basis');
    expect(basisSummary(basisLines(entry({ basis: { subject: '', reads: [read], message: 12 } })))).toBe('ui.audit.basis');
    expect(basisSummary(basisLines(entry({ basis: { subject: 'Approve the push', reads: [], message: 12 } })))).toBe('ui.audit.basis.decided');
    expect(basisSummary(basisLines(entry({ basis: { subject: '', reads: [], message: 12 } })))).toBeNull();
    expect(basisSummary(basisLines(entry()))).toBeNull();
  });
});

describe('the words of the screen', () => {
  const keys = ['ui.audit.kind.config', 'ui.audit.kind.secret', 'ui.audit.kind.pluginDecision', 'ui.audit.kind.act', 'ui.audit.who.label', 'ui.audit.who.all', 'ui.audit.who.person', 'ui.audit.who.persona', 'ui.audit.who.agent', 'ui.audit.badge.persona', 'ui.audit.door', 'ui.audit.door.window', 'ui.audit.door.paired', 'ui.audit.said', 'ui.audit.ownProposal', 'ui.audit.basis', 'ui.audit.basis.decided', 'ui.audit.basis.subject', 'ui.audit.basis.message', 'ui.audit.actOlder'];

  it('has the four new kinds, the filter, the badge and the fold in both catalogs, worded differently', () => {
    for (const key of keys) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((ptBR as Record<string, string>)[key], key).toBeTruthy();
      expect((en as Record<string, string>)[key], key).not.toBe((ptBR as Record<string, string>)[key]);
    }
  });

  it('draws the persona with a badge, the kinds from the table and no colour of its own', () => {
    const text = readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/Auditoria.tsx'), 'utf8');
    expect(text).toContain("t('ui.audit.badge.persona')");
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });
});
