// What the retro raises now: no improvement in the record nor on the screen, each improvement of the conversation becomes a proposal in Actions that opens an
// issue and starts the task on it after the person's "yes", and an improvement the workspace cannot turn into an issue stays in the conversation with the reason.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { ReleaseAction, Retro } from '../src/shared/types';
import { hostConfig } from './helpers/config';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Boot, boot, doc, issue, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const asked = vi.hoisted(() => ({ prompts: [] as string[], answer: {} as Record<string, unknown> }));
vi.mock('../src/main/agents', async (orig) => ({
  ...(await orig<typeof import('../src/main/agents')>()),
  askAgent: async (_role: string, prompt: string) => {
    asked.prompts.push(prompt);
    return { data: asked.answer, sessionId: 's1', partial: false };
  },
}));

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { saveConfig } = await import('../src/main/workspaceConfig');
const actions = await import('../src/main/actions');
const retro = await import('../src/main/retro');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { writeRegistry } = await import('../src/main/workspaces-core');
const { onRunnerActionDone } = await import('../src/main/runner/door');
const { retroIssueDone } = await import('../src/main/runner/module');
const state = await import('../src/main/state');
const minutes = await import('../src/main/minutesStore');
const suggestionMod = await import('../src/main/suggestionsModule');
const { ceremony } = await import('./helpers/ceremony');

const DIR = join(ATAS, 'retros');
const day = (): string => new Date().toLocaleDateString('sv-SE');

let forge: Forge;
let stop: (() => void) | null = null;

/** The workspace of the tests: a GitHub host that holds the issues, in pt-BR (the language in which the notes of the conversation are asserted). */
function useConfig(over: (c: WorkspaceConfig) => void = () => undefined): void {
  const c = hostConfig('github', { language: 'pt-BR' });
  c.projects.issues.project = 'group/project';
  c.projects.issues.refPrefix = 'app#';
  over(c);
  saveConfig(c);
}

const withHost = (c: WorkspaceConfig): void => {
  c.language = 'pt-BR';
  c.vcs = [{ id: 'host', kind: 'github', host: 'github.com', apiUrl: '', user: '', secretRef: null, cliPreference: 'auto', cliCommand: null }];
  c.projects.issues.vcsId = 'host';
};

const asReal = (test: boolean): void => {
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });
};

/** The retro the conversation adds to, as the app stores it. */
const stored = (over: Partial<Retro> = {}): Retro => ({
  id: day(),
  from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  to: new Date().toISOString(),
  sessionId: null,
  speech: 'Foi uma semana de revisões longas.',
  numbers: [],
  worked: [],
  stuck: [],
  rework: [],
  talk: [],
  createdAt: new Date().toISOString(),
  ...over,
});

const improvement = (titulo: string, over: Partial<{ dimensao: string; problema: string; proposta: string }> = {}) => ({
  titulo,
  dimensao: 'Entrega',
  problema: `O problema de ${titulo}`,
  proposta: `A proposta para ${titulo}`,
  ...over,
});

const answer = (melhorias: unknown[]): Record<string, unknown> => ({ fala: 'Falado.', texto: 'Dito.', melhorias });

const isRetroIssue = (a: ReleaseAction): boolean => String((a.unit ?? {}).purpose ?? '') === 'retro-issue';
const proposals = (): ReleaseAction[] => actions.listActions().filter(isRetroIssue);
const note = (r: Retro, text: string): boolean => r.talk.some((m) => !m.me && m.text.includes(text));

beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['retros', 'runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  stop?.();
  stop = null;
  asked.prompts.length = 0;
  asked.answer = {};
  setVcsRuntimeForTests(null);
  asReal(false);
  useConfig();
});

afterAll(() => stop?.());

describe('the retro of a workspace that changed', () => {
  it('opens a record written before the change: its extra field is ignored and the screen has no improvement section', () => {
    mkdirSync(DIR, { recursive: true });
    // What an app of the previous version left behind: the field is still in the file and nothing reads it any more.
    writeFileSync(join(DIR, `${day()}.json`), JSON.stringify({ ...stored(), improvements: [{ title: 'Uma melhoria antiga', evidence: 'antes' }] }));
    const found = retro.latestRetro();
    expect(found).toMatchObject({ id: day(), speech: 'Foi uma semana de revisões longas.', worked: [], stuck: [], rework: [], talk: [] });
    expect(retro.readRetro(day())?.id).toBe(day());
    // The section is gone from the screen and from both catalogs.
    const screen = readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/RetroScreen.tsx'), 'utf8');
    expect(screen).not.toContain('ui.retro.improvements');
    for (const lang of ['pt-BR', 'en']) {
      const catalog = readFileSync(join(import.meta.dirname, `../src/shared/i18n/ui-docs.${lang}.json`), 'utf8');
      expect(catalog).not.toContain('ui.retro.improvements');
    }
  });

  it('prepares the retro without asking the model for improvements and writes none', async () => {
    asked.answer = { fala: 'Falado.', numeros: [], funcionou: [{ titulo: 'Funcionou', evidencia: 'e' }], travou: [], retrabalho: [] };
    const held = await retro.prepareRetro();
    expect(asked.prompts).toHaveLength(1);
    expect(asked.prompts[0]).not.toMatch(/improvement|melhoria/i);
    expect('improvements' in held).toBe(false);
    const file = JSON.parse(readFileSync(join(DIR, `${held.id}.json`), 'utf8')) as Record<string, unknown>;
    expect('improvements' in file).toBe(false);
    expect(file.worked).toEqual([{ title: 'Funcionou', evidence: 'e' }]);
  });
});

describe('what the conversation of the retro raises', () => {
  it('turns each improvement of the answer into a proposal in Actions, says it in the conversation and writes nothing yet', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    retro.writeRetro(stored());
    asked.answer = answer([improvement('Encurtar o ciclo de revisão'), improvement('Registrar o que travou', { dimensao: 'Fluxo' })]);

    const after = await retro.askRetro(day(), 'o que travou?');

    const made = proposals();
    expect(made).toHaveLength(2);
    const one = made.find((a) => a.summary === 'Abrir a issue "Encurtar o ciclo de revisão"');
    const two = made.find((a) => a.summary === 'Abrir a issue "Registrar o que travou"');
    expect(one).toMatchObject({ state: 'pending', kind: 'vcs', issue: 0, command: { method: 'POST', endpoint: 'repos/group/project/issues' } });
    expect(one?.unit).toEqual({ purpose: 'retro-issue', retro: day(), key: `retro-issue:${day()}:encurtar-o-ciclo-de-revisao` });
    expect(two?.unit).toMatchObject({ key: `retro-issue:${day()}:registrar-o-que-travou` });
    // the body the issue will carry, with the dimension, what happens today and what it would be
    expect(one?.output).toContain('**Dimensão:** Entrega');
    expect(one?.output).toContain('**Problema hoje:** O problema de Encurtar o ciclo de revisão');
    expect(one?.output).toContain('**O que seria:** A proposta para Encurtar o ciclo de revisão');
    expect(one?.output).toContain('Da retro de ');
    expect(one?.output).toContain(`(${day()}).`);
    expect(two?.output).toContain('**Dimensão:** Fluxo');
    // the conversation says what waits in Actions, in the order they came
    expect(after.talk.filter((m) => !m.me && m.text.includes('está em Ações como proposta')).map((m) => m.text)).toEqual([
      '"Encurtar o ciclo de revisão" está em Ações como proposta para abrir uma issue e iniciar uma tarefa.',
      '"Registrar o que travou" está em Ações como proposta para abrir uma issue e iniciar uma tarefa.',
    ]);
    // the question, the answer and the two notes; the tracker untouched and the record with no improvement of its own
    expect(after.talk).toHaveLength(4);
    expect(forge.writes).toEqual([]);
    expect(forge.issues.size).toBe(0);
    expect('improvements' in after).toBe(false);
    const file = JSON.parse(readFileSync(join(DIR, `${day()}.json`), 'utf8')) as Record<string, unknown>;
    expect('improvements' in file).toBe(false);
  });

  it('does not propose the same improvement twice: the one already waiting in Actions is not raised again', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    retro.writeRetro(stored());
    asked.answer = answer([improvement('Encurtar o ciclo de revisão')]);

    await retro.askRetro(day(), 'o que travou?');
    const again = await retro.askRetro(day(), 'e sobre isso?');

    expect(proposals()).toHaveLength(1);
    expect(again.talk.filter((m) => m.text.includes('está em Ações como proposta'))).toHaveLength(1);
    // the second round is there (the question and the answer), it just adds no proposal
    expect(again.talk.filter((m) => m.me)).toHaveLength(2);
    expect(forge.writes).toEqual([]);
  });

  it('still gives each improvement its own proposal when two titles normalize to the same key', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    retro.writeRetro(stored());
    // only the first forty characters of the normalized title make the key, so these two would collide without the index
    const long = 'A'.repeat(45);
    asked.answer = answer([improvement(`${long} um`), improvement(`${long} dois`)]);

    const after = await retro.askRetro(day(), 'o que travou?');

    const made = proposals();
    expect(made).toHaveLength(2);
    expect(new Set(made.map((a) => (a.unit ?? {}).key)).size).toBe(2);
    expect(after.talk.filter((m) => !m.me && m.text.includes('está em Ações como proposta'))).toHaveLength(2);
    expect(forge.writes).toEqual([]);
  });
});

describe('the end of a retro, before it is stored', () => {
  /**
   * One ceremony whose decision is the evidence a suggestion rests on, in a retro of the same squad, earlier in the week: a retro of a squad looks
   * at the ceremonies held for it (the fixture's window is thirty days).
   */
  const decision = (day0: string, text: string): void => {
    const id = `${day0}T090000`;
    const made = ceremony({ id, decisions: [{ ref: 'app#123', text, target: 'note', dest: '' }] });
    state.saveState(made);
    retro.writeRetro({ ...stored({ squad: 'squad-1' }), id: day0, from: new Date(`${day0}T00:00:00Z`).toISOString(), to: new Date(`${day0}T23:00:00Z`).toISOString() });
    minutes.registerCeremony(made);
    minutes.commitVersion(day0, minutes.versionOfCeremony(id) ?? 1, { teams: '', written: [] });
  };

  it('stores the retro before the suggestions read the history, so the retro just answered is the evidence', async () => {
    const medal = 'Keep the legacy exporter for one release';
    // The minutes of the retro that was just answered: a ceremony of the day, held for the same squad, whose decision is the theme the other days repeat.
    const answered = `${day()}-squad-1`;
    const id = `${day()}T090000`;
    const made = ceremony({ id, decisions: [{ ref: 'app#123', text: medal, target: 'note', dest: '' }] });
    state.saveState(made);
    minutes.registerCeremony(made);
    minutes.commitVersion(day(), minutes.versionOfCeremony(id) ?? 1, { teams: '', written: [] });
    retro.writeRetro(stored({ id: answered, squad: 'squad-1' }));
    asked.answer = { fala: 'Falado.', texto: 'Dito.', melhorias: [] };

    const after = await retro.askRetro(answered, 'o que travou?');

    // The retro was stored before the reading: the one held for the squad that was just answered is on disk when the reading happens.
    expect(retro.readRetro(answered)?.id).toBe(answered);
    expect(retro.latestRetro('squad-1')?.id).toBe(answered);
    // The minutes of the retro are part of the history the reading looks at, so the suggestion the draft would rest on has its evidence.
    expect(after.talk).toHaveLength(2);
    expect(state.listHistory().some((e) => e.id === id)).toBe(true);
  });

  it('reads the retro of a squad, and not only the retros of the whole workspace', () => {
    retro.writeRetro({ ...stored(), id: '2026-10-05' });
    retro.writeRetro({ ...stored({ squad: 'squad-1' }), id: '2026-10-05-squad-1' });
    expect(retro.latestRetro('squad-1')?.id).toBe('2026-10-05-squad-1');
    expect(retro.latestRetro()?.id).toBe('2026-10-05');
  });

  it('lets a suggestion whose impression was rejected come back when the retro that was just answered is the new evidence', async () => {
    const medal = 'Keep the legacy exporter for one release';
    // The retro of the day, held for the squad, answers the reason it was asked; what it records is the minute of the ceremony.
    const answered = `${day()}-squad-1`;
    retro.writeRetro(stored({ id: answered, squad: 'squad-1' }));
    // The three ceremonies of the week; the suggestion the model would draft from them is the impression the rejection holds.
    for (const day0 of ['2026-09-28', '2026-09-29', '2026-09-30']) decision(day0, medal);
    const pattern = suggestionMod.readPatterns().find((p) => p.kind === 'ceremony-decision');
    if (!pattern) throw new Error('no ceremony pattern');
    const impression = `keeper:${pattern.stage}:${pattern.kind}`;
    const { writeSuggestions } = await import('../src/main/suggestions');
    writeSuggestions({
      records: [
        {
          id: 's-rejected',
          impression,
          proposed: { name: 'Keeper', role: 'Keeper', stage: pattern.stage, prompt: 'p', permission: 'read' },
          evidence: pattern.evidence,
          decision: 'rejected',
          reason: null,
          by: 'person',
          at: '2026-10-01T00:00:00Z',
          agentId: null,
          evidenceKey: 'x',
        },
      ],
    });
    asked.answer = { fala: 'Falado.', texto: 'Dito.', melhorias: [] };

    const after = await retro.askRetro(answered, 'o que travou?');

    // The impression was rejected from the three ceremonies the rejection saw; the one the retro added is evidence it never saw, so the suggestion
    // comes back and the card says it was refused before. A reading that still used the history from before the retro would offer nothing at all.
    expect(after.talk).toHaveLength(2);
    expect(retro.readRetro(answered)?.id).toBe(answered);
    expect(suggestionMod.readPatterns().find((p) => p.kind === 'ceremony-decision')?.evidence.length).toBe(pattern.evidence.length);
  });
});

describe('the issue a retro improvement opens', () => {
  /** A workspace that can write issues, with the host standing in and the listener that starts the task on the issue the host made. */
  async function running(): Promise<Boot> {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: withHost });
    b.engine.script('support', () => work('Triado.', { artifacts: [doc('0_TRIAGE.md')] }));
    b.engine.script('dev-a', () => work('Feito.', { artifacts: [doc('3_IMPLEMENTATION.md')] }));
    stop = onRunnerActionDone((a, responses) => retroIssueDone(a, responses, (ref) => b.runner.start(ref)));
    // the issue the forge will number first
    b.issues.add(issue(200, { title: 'Encurtar o ciclo de revisão' }));
    retro.writeRetro(stored());
    asked.answer = answer([improvement('Encurtar o ciclo de revisão')]);
    await retro.askRetro(day(), 'o que travou?');
    return b;
  }

  it('is created on the host at the "yes", audited, and the task on it starts by itself', async () => {
    const b = await running();
    const proposal = proposals()[0];
    expect(proposal.state).toBe('pending');
    expect(forge.issues.size).toBe(0);
    expect(b.runner.list()).toEqual([]);

    await actions.approveAction(proposal.id);

    expect(forge.issues.get(200)).toMatchObject({ title: 'Encurtar o ciclo de revisão', labels: [], state: 'open' });
    expect(forge.issues.get(200)?.body).toContain('**Problema hoje:** O problema de Encurtar o ciclo de revisão');
    expect(listAudit().find((a) => a.target === 'POST repos/group/project/issues')).toMatchObject({ ok: true, kind: 'github' });
    // the issue exists and the task on it started without another "sim"
    await vi.waitFor(() => expect(b.runner.list().some((r) => r.issue.iid === 200)).toBe(true), { timeout: 10_000 });
    await b.settle();
    const started = b.runner.list().filter((r) => r.issue.iid === 200);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ repo: 'app' });
    // the conversation never had to say the task could not start
    expect(retro.readRetro(day())?.talk.some((m) => m.text.includes('mas a tarefa não começou'))).toBe(false);
  });

  it('is refused in a test workspace: the proposal waits, nothing is written and no task starts', async () => {
    asReal(true);
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: withHost });
    stop = onRunnerActionDone((a, responses) => retroIssueDone(a, responses, (ref) => b.runner.start(ref)));
    retro.writeRetro(stored());
    asked.answer = answer([improvement('Encurtar o ciclo de revisão')]);
    await retro.askRetro(day(), 'o que travou?');

    const proposal = proposals()[0];
    expect(proposal.state).toBe('pending');
    await expect(actions.approveAction(proposal.id)).rejects.toThrow(/Workspace de testes/);

    expect(forge.writes).toEqual([]);
    expect(forge.issues.size).toBe(0);
    expect(b.runner.list()).toEqual([]);
    // a refusal does not spend the proposal: it is still there, waiting
    expect(proposals()[0].state).toBe('pending');
  });

  it('is not opened at all when the person says "not now", and the record keeps no improvement', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    retro.writeRetro(stored());
    asked.answer = answer([improvement('Encurtar o ciclo de revisão')]);
    const said = await retro.askRetro(day(), 'o que travou?');

    await actions.skipAction(proposals()[0].id);

    expect(proposals()[0].state).toBe('skipped');
    expect(forge.writes).toEqual([]);
    expect(forge.issues.size).toBe(0);
    // the question, the answer and the note that says the proposal waits in Actions
    expect(said.talk).toHaveLength(3);
    expect(note(said, 'está em Ações como proposta')).toBe(true);
    expect('improvements' in (retro.readRetro(day()) as Retro)).toBe(false);
  });
});

describe('an improvement that cannot become a task', () => {
  /** What the conversation says about the improvement, with the workspace as it is now. */
  async function said(): Promise<string[]> {
    retro.writeRetro(stored());
    asked.answer = answer([improvement('Encurtar o ciclo de revisão')]);
    const after = await retro.askRetro(day(), 'o que travou?');
    return after.talk.filter((m) => m.text.includes('fica só nesta conversa')).map((m) => m.text);
  }

  it('stays in the conversation when the workspace has no issue project', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    useConfig((c) => {
      c.projects.issues.project = null;
    });

    const notes = await said();

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"Encurtar o ciclo de revisão" fica só nesta conversa: ');
    expect(notes[0]).toContain('projeto de issues');
    expect(proposals()).toEqual([]);
    expect(forge.writes).toEqual([]);
  });

  it('stays in the conversation when the integration exists but does not write issues', async () => {
    forge = makeForge();
    const base = forge.runtime();
    setVcsRuntimeForTests({ ...base, provider: { ...base.provider, caps: { ...base.provider.caps, issues: false } } });

    const notes = await said();

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('não escreve issue');
    expect(proposals()).toEqual([]);
    expect(forge.writes).toEqual([]);
  });

  it('stays in the conversation when the workspace has no integration that holds the issues', async () => {
    useConfig((c) => {
      c.vcs = [];
      c.projects.issues.vcsId = null;
    });

    const notes = await said();

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('integração');
    expect(proposals()).toEqual([]);
  });

  it('stays in the conversation when the host refuses the title', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    retro.writeRetro(stored());
    asked.answer = answer([improvement('T'.repeat(300))]);

    const after = await retro.askRetro(day(), 'o que travou?');

    const notes = after.talk.filter((m) => m.text.includes('fica só nesta conversa')).map((m) => m.text);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Requisição inválida');
    expect(proposals()).toEqual([]);
    expect(forge.writes).toEqual([]);
  });
});
