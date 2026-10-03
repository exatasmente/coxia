import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig, withConfigDefaults } from '../src/shared/config';
import type { AgentTurn, Card } from '../src/shared/types';
import { setLanguage } from '../src/shared/i18n';

// The reply of the call with a scripted engine: what the agent is told about priority, what it may answer, and the decision that comes out.

let seen: { prompt: string; schema: { properties: Record<string, { anyOf?: { properties?: Record<string, { enum: string[] }> }[] }> } };
let answer: Record<string, unknown> = {};

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));

let agents: typeof import('../src/main/agents');
let config: typeof import('../src/main/workspaceConfig');

const card = (over: Partial<Card> = {}): Card => ({
  ref: 'app#12', iid: '12', title: 'Fix the export', stage: 'Doing', spec: null, mrs: [], mrPaths: [], blockers: [], pending: [], changes: [], note: null, url: 'https://git.example.test/acme/app/-/issues/12',
  labels: ['bug', 'P1'], project: 'acme/app', priority: { rank: 1, label: 'P1' }, ...over,
});
const turn: AgentTurn = { ref: 'app#12', sessionId: 'sess-1', speech: 'Spoke.', did: 'a', next: 'b', blocker: null, question: null };

const base = { ack: 'Done.', decisao: null, efeito: null, desbloqueio: false, prioridade: null, opcoes: [] };

async function configure(levels: string[], over: Record<string, unknown> = {}): Promise<void> {
  const c = neutralConfig();
  c.devCycle.priority.labels = levels;
  config.saveConfig(withConfigDefaults({ ...c, ...over }));
}

beforeAll(async () => {
  agents = await import('../src/main/agents');
  config = await import('../src/main/workspaceConfig');
  const { registerEngine } = await import('../src/main/engine/registry');
  registerEngine('claude-sdk', (async (req: { prompt: string; schema: typeof seen.schema }) => {
    seen = { prompt: req.prompt, schema: req.schema };
    return { data: answer, sessionId: 'sess-1', sources: [] };
  }) as never);
});

beforeEach(() => {
  setLanguage('pt-BR');
  answer = { ...base };
});

describe('what the reply agent is told about priority', () => {
  it('lists the configured labels, the card\'s current one, and lets only those (and the two ends) through', async () => {
    await configure(['^P0$', '^P1$', '^P[23]$', 'P4']);
    await agents.reply(card(), turn, 'raise this one');
    expect(seen.prompt).toContain('"prioridade": só se');
    expect(seen.prompt).toContain('"first" (o nível mais alto), "later" (o mais baixo) ou exatamente um destes rótulos, do mais alto ao mais baixo: P0, P1, P4.');
    expect(seen.prompt).toContain('(P1)');
    expect(seen.schema.properties.prioridade.anyOf?.[1].properties?.para.enum).toEqual(['first', 'later', 'P0', 'P1', 'P4']);
  });

  it('says there are no labels when the workspace has none, and still lets "first" and "later" through', async () => {
    await configure([]);
    await agents.reply(card(), turn, 'this one goes first');
    expect(seen.prompt).toContain('Este tracker não tem rótulos de prioridade configurados');
    expect(seen.schema.properties.prioridade.anyOf?.[1].properties?.para.enum).toEqual(['first', 'later']);
  });

  it('is written in the language of the workspace', async () => {
    await configure(['^P0$'], { language: 'en' });
    setLanguage('en');
    await agents.reply(card({ priority: null }), turn, 'raise it');
    expect(seen.prompt).toContain('"prioridade" (priority): only if');
    expect(seen.prompt).toContain('from the highest to the lowest: P0.');
    expect(seen.prompt).toContain('(none)');
  });
});

describe('the decision a reply gives back', () => {
  it('is none when the agent answers null', async () => {
    await configure(['^P0$', '^P1$']);
    expect((await agents.reply(card(), turn, 'ok')).priority).toBeNull();
  });

  it('"this one goes first" becomes a decision that says what changes and that it waits in Actions', async () => {
    await configure(['^P0$', '^P1$']);
    answer = { ...base, prioridade: { para: 'first' } };
    const r = await agents.reply(card(), turn, 'this one goes first');
    expect(r.priority).toMatchObject({
      ref: 'app#12',
      text: 'Prioridade de app#12: P1 → P0',
      target: 'priority',
      dest: 'proposta de troca de rótulo em Ações, à espera do seu "sim"',
      priority: { to: 'first', from: 'P1', label: 'P0', add: 'P0', remove: ['P1'], noWrite: null, project: 'acme/app', iid: 12 },
    });
    expect(r.decision).toBeNull();
  });

  it('comes next to an ordinary decision of the same answer', async () => {
    await configure(['^P0$', '^P1$']);
    answer = { ...base, decisao: { texto: 'Ship it Friday', alvo: 'ata' }, prioridade: { para: 'later' } };
    const r = await agents.reply(card(), turn, 'ship it friday, and leave the rest for later');
    expect(r.decision?.text).toBe('Ship it Friday');
    expect(r.priority).toMatchObject({ text: 'Prioridade de app#12: P1 → P1', priority: { label: 'P1', add: null, noWrite: 'same' } });
  });

  it('without priority labels stays in the minutes and says it was not written to the tracker', async () => {
    await configure([]);
    answer = { ...base, prioridade: { para: 'first' } };
    const r = await agents.reply(card({ labels: [], priority: null }), turn, 'this one goes first');
    expect(r.priority).toMatchObject({
      text: 'Prioridade de app#12: vai primeiro',
      target: 'priority',
      dest: 'ata (não gravado no tracker: este workspace não tem rótulos de prioridade configurados)',
      priority: { noWrite: 'unconfigured', label: null, add: null },
    });
    setLanguage('en');
    answer = { ...base, prioridade: { para: 'later' } };
    expect((await agents.reply(card({ labels: [], priority: null }), turn, 'leave it for next week')).priority).toMatchObject({
      text: 'Priority of app#12: waits',
      dest: 'minutes (not written to the tracker: this workspace has no priority labels configured)',
    });
  });

  it('on a host that cannot change labels stays in the minutes too', async () => {
    await configure(['^P0$', '^P1$'], { vcs: [{ id: 'bb', kind: 'bitbucket', host: 'bitbucket.org' }], projects: { ...neutralConfig().projects, issues: { vcsId: 'bb', project: 'acme/app', projectId: null, refPrefix: 'app#' } } });
    answer = { ...base, prioridade: { para: 'first' } };
    const r = await agents.reply(card(), turn, 'this one goes first');
    expect(r.priority).toMatchObject({ target: 'priority', priority: { noWrite: 'unsupported', label: 'P0', add: 'P0' }, dest: expect.stringContaining('este host não permite trocar rótulos') });
  });
});
