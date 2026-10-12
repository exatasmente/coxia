// The footer on the text the persona composes for the code host (#248): fixed, worded by the app, once, in the workspace's language, on the fields an operation marks as host text
// under the persona and on nothing under the person, and on nothing that stays inside the app.
import { describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage } from '../src/shared/i18n';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const { FOOTER_KEY, signHostText } = await import('../src/main/persona/footer');
const { createDoor } = await import('../src/main/persona/door');
const { createSession } = await import('../src/main/persona/session');
const { OPS } = await import('../src/main/persona/doorTable');
const { handle } = await import('../src/main/rpc');

const session = () => createSession({ persona: 'me', thread: 'agent-me', seq: 1, door: 'window' });
const why = 'Because the person asked me to.';

describe('the footer', () => {
  it('is added once, after a blank line, in the language in force, and a text that already ends with it is not signed twice', () => {
    setLanguage('en');
    const en = signHostText('Looks good to me.');
    expect(en).toBe(`Looks good to me.\n\n${CATALOGS.en[FOOTER_KEY]}`);
    expect(signHostText(en)).toBe(en);
    setLanguage('pt-BR');
    const pt = signHostText('Parece bom.\n');
    expect(pt).toBe(`Parece bom.\n\n${CATALOGS['pt-BR'][FOOTER_KEY]}`);
    // A footer in the other language counts too: changing the language does not sign a text again.
    expect(signHostText(en)).toBe(en);
    expect(signHostText(pt)).toBe(pt);
    setLanguage('en');
    expect(signHostText('')).toBe(CATALOGS.en[FOOTER_KEY]);
  });

  it('says in both catalogs that the persona wrote it, on behalf of the person, and names nobody', () => {
    expect(CATALOGS.en[FOOTER_KEY]).toMatch(/persona/i);
    expect(CATALOGS['pt-BR'][FOOTER_KEY]).toMatch(/persona/i);
    expect(CATALOGS.en[FOOTER_KEY]).not.toBe(CATALOGS['pt-BR'][FOOTER_KEY]);
    expect(CATALOGS.en[FOOTER_KEY].split('\n')).toHaveLength(1);
  });

  it('is added by the door to the fields of the operations marked as host text, and to no other argument', async () => {
    setLanguage('en');
    const seen: unknown[][] = [];
    handle('t:host', ((...args: unknown[]) => void seen.push(args)) as never);
    const op = { tool: 'Board' as const, op: 'comment', channel: 't:host', write: true, args: [{ name: 'id', type: 'string' as const }, { name: 'body', type: 'text' as const }, { name: 'title', type: 'text' as const }], hostText: ['body'] };
    const door = createDoor({ table: [op], hooks: () => ({}), stopped: () => false });
    await door.run(session(), 'Board', { op: 'comment', id: 'c1', body: 'A comment.', title: 'A title', why });
    expect(seen[0]).toEqual(['c1', `A comment.\n\n${CATALOGS.en[FOOTER_KEY]}`, 'A title']);
    // signed once even when the model already wrote the footer itself
    await door.run(session(), 'Board', { op: 'comment', id: 'c1', body: `Done.\n\n${CATALOGS.en[FOOTER_KEY]}`, why });
    expect(seen[1][1]).toBe(`Done.\n\n${CATALOGS.en[FOOTER_KEY]}`);
  });

  it('is on exactly the text that goes to the host: a card\'s body and comment, and a reply to a discussion; not a forum post, a memory note or a card note', () => {
    const marked = OPS.filter((o) => o.hostText).map((o) => `${o.tool}.${o.op}:${o.hostText?.join(',')}`).sort();
    expect(marked).toEqual(['Board.comment:body', 'Board.create:body', 'Board.update:body', 'Ceremonies.discussionsReply:body']);
    for (const key of ['Conversations.post', 'Memory.save', 'Ceremonies.saveMinutes', 'Runs.answer']) {
      const o = OPS.find((x) => `${x.tool}.${x.op}` === key);
      expect(o?.hostText, key).toBeUndefined();
    }
  });
});

describe('the board, with the persona and with the person', () => {
  it('signs a card the persona creates, and leaves the title and a card the person creates alone', async () => {
    setLanguage('en');
    const { saveConfig } = await import('../src/main/workspaceConfig');
    const { neutralConfig } = await import('../src/shared/config');
    const base = neutralConfig();
    saveConfig({ ...base, language: 'en', devCycle: { ...base.devCycle, stages: [{ id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 }] } });
    const { register: board } = await import('../src/main/board');
    const { bindIpc } = await import('../src/main/rpc');
    const { personaDoor } = await import('../src/main/persona/door');
    const ipc = new Map<string, (...args: unknown[]) => unknown>();
    bindIpc((channel, fn) => ipc.set(channel, fn as (...args: unknown[]) => unknown));
    board({ handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined } as never);
    await personaDoor.run(session(), 'Board', { op: 'create', title: 'Persona card', body: 'Please look at this.', column: 'backlog', why });
    const view = (await ipc.get('board:list')?.()) as { cards: { title: string; body: string }[] };
    const mine = view.cards.find((c) => c.title === 'Persona card');
    expect(mine?.body).toBe(`Please look at this.\n\n${CATALOGS.en[FOOTER_KEY]}`);
    await ipc.get('board:create')?.({ title: 'Person card', body: 'My own text.', column: 'backlog' });
    const again = (await ipc.get('board:list')?.()) as { cards: { title: string; body: string }[] };
    expect(again.cards.find((c) => c.title === 'Person card')?.body).toBe('My own text.');
  });
});
