import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, Minutes } from '../../src/shared/types';

// Runs every ceremony prompt builder against a fake engine and records what the agent would have been told.
// The same scenarios run against the original code (the golden file) and against the template-driven code, so a refactor can prove it
// says the same thing. Needs these mocks in the calling test file:
//   vi.mock('../src/main/workspace', ...)  (writes are allowed)
//   vi.mock('node:child_process', ...)     (see mockGlab below)

export interface Captured {
  role: string;
  prompt: string;
  system: string;
  maxTurns: number | null;
  resume: string | null;
  allowedTools: string[];
  extraDirs: string[];
  schemaKeys: string[];
}

type Schema = { type?: unknown; properties?: Record<string, Schema>; items?: Schema; minItems?: number; enum?: unknown[]; anyOf?: Schema[] };

// A value that satisfies the schema, with the shortest content: what the fake agent answers.
export function sample(s: Schema | undefined): unknown {
  if (!s) return 'x';
  if (s.enum) return s.enum[0];
  if (s.anyOf) return sample(s.anyOf.find((x) => x.type === 'null') ?? s.anyOf[0]);
  const type = Array.isArray(s.type) ? (s.type.includes('null') ? 'null' : s.type[0]) : s.type;
  if (type === 'null') return null;
  if (type === 'object') return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sample(v)]));
  if (type === 'array') return Array.from({ length: s.minItems ?? 0 }, () => sample(s.items));
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return 0;
  return 'x';
}

export const calls: Captured[] = [];

export async function installFakeEngine(): Promise<void> {
  await import('../../src/main/agents'); // registers the real engines at import; the fake goes in after
  const { registerEngine } = await import('../../src/main/engine/registry');
  registerEngine('claude-sdk', (async (req: {
    role: string;
    prompt: string;
    system: string;
    schema: Schema;
    allowedTools: string[];
    extraDirs: string[];
    extra: { maxTurns?: number; resume?: string };
  }) => {
    calls.push({
      role: req.role,
      prompt: req.prompt,
      system: req.system,
      maxTurns: req.extra.maxTurns ?? null,
      resume: req.extra.resume ?? null,
      allowedTools: req.allowedTools,
      extraDirs: req.extraDirs,
      schemaKeys: Object.keys(req.schema.properties ?? {}),
    });
    const data = sample(req.schema) as Record<string, unknown>;
    // The diagram has to land on a heading that exists in the artifact.
    if ('heading' in data && 'mermaid' in data) Object.assign(data, { mermaid: 'flowchart TD\nA-->B', heading: 'Causa', descricao: 'mostra o fluxo' });
    return { data, sessionId: 'sess-1', sources: [] };
  }) as never);
}

const note = { id: 11, author: 'qa.interno', body: 'Reprovado: o filtro por grupo continua listando todos os agentes.', createdAt: '2026-09-30T10:00:00Z', system: false, webUrl: null };

/** The slice of the code host the feedback module reads: one QA note on the issue, one open thread on a merge request. */
export const fakeVcs = {
  listIssueComments: async () => [note],
  listMrThreads: async () => [],
  getMrThread: async (_project: string, _iid: number, id: string) => ({
    id,
    resolvable: true,
    resolved: false,
    path: 'app/Report.php',
    line: 42,
    notes: [{ ...note, id: 12, author: 'revisor', body: 'Esse trecho ignora o grupo.' }],
  }),
  noteUrl: () => 'https://example.test/note',
  issueStatuses: async () => new Map<number, string>(),
} as never;

export function specFiles(specsDir: string, registro = 'Registro de decisões'): { folder: string; plan: string } {
  const folder = join(specsDir, '#15499-corrigir-filtro');
  mkdirSync(join(folder, 'bug'), { recursive: true });
  writeFileSync(join(folder, 'bug', '0_BUG_REPORT.md'), '# Bug\n');
  writeFileSync(join(folder, 'bug', '1_INVESTIGATION.md'), '# Investigation\n\n## Causa\n\ntexto\n');
  const plan = join(folder, 'bug', '2_PLAN.md');
  writeFileSync(plan, `# Plan\n\n## Passos\n\n- um\n\n## ${registro}\n\n- 2026-09-01: anterior\n\n## Rollback\n\nnada\n`);
  writeFileSync(join(folder, 'bug', '3_TEST_PLAN.md'), '# Test plan\n');
  writeFileSync(join(folder, 'ISSUE_COMPLETION.md'), '# Completion\n');
  return { folder, plan };
}

export function cardFixture(folder: string, plan: string, over: Partial<Card> = {}): Card {
  return {
    ref: 'sz4#15499',
    iid: '15499',
    title: 'Corrigir filtro do relatório',
    stage: 'Code Review OK',
    spec: { folder, phase: 'Plan escrito', planFile: plan },
    mrs: ['sz4!797'],
    mrPaths: [{ ref: 'sz4!797', project: 'sz4/sz4', iid: 797 }],
    blockers: ['sz4!797: MR com conflitos'],
    pending: ['pipeline vermelha'],
    changes: ['stage: Doing → Code Review'],
    note: null,
    url: 'https://dark.smartzap.com.br/sz4/sz4/-/work_items/15499',
    ...over,
  };
}

export interface Scenario {
  prompts: Record<string, Captured>;
  files: Record<string, string>;
}

// The prompts of every ceremony, in the order a day goes: pre-daily, unblock, summary, gate, QA hand-off, retro, return from QA, release sync.
export async function runScenario(specsDir: string, opts: { registro?: string } = {}): Promise<Scenario> {
  const agents = await import('../../src/main/agents');
  const gate = await import('../../src/main/gate');
  const qa = await import('../../src/main/qa');
  const retro = await import('../../src/main/retro');
  const feedback = await import('../../src/main/feedback');
  const store = await import('../../src/main/store');

  const { folder, plan } = specFiles(specsDir, opts.registro);
  const card = cardFixture(folder, plan);
  const bare = cardFixture(folder, plan, { ref: 'sz4#15500', iid: '15500', spec: null, blockers: [], pending: [], changes: [] });
  const prompts: Record<string, Captured> = {};
  const files: Record<string, string> = {};
  const grab = async (name: string, fn: () => Promise<unknown>) => {
    const before = calls.length;
    await fn();
    const made = calls.slice(before);
    made.forEach((c, i) => (prompts[made.length > 1 ? `${name}#${i + 1}` : name] = c));
  };
  const turn = { ref: card.ref, sessionId: null, speech: 'Falei sobre o filtro.', did: 'a', next: 'b', blocker: null, question: null };
  const live = { ...turn, sessionId: 'sess-live' };

  await grab('turn', () => agents.prepareTurn(card));
  await grab('turn-without-spec', () => agents.prepareTurn(bare));
  await grab('reply', () => agents.reply(card, turn, 'pode seguir com o merge'));
  await grab('reply-resumed', () => agents.reply(card, live, 'pode seguir com o merge'));
  await grab('deep', () => agents.deepAsk(card, 'por que a pipeline falha?', null));
  await grab('deep-resumed', () => agents.deepAsk(card, 'e o rollback?', 'sess-deep'));
  await grab('deep-options', () => agents.deepOptions(card, 'sess-deep'));
  const minutes: Minutes = {
    startedAt: '2026-10-02T09:40:00Z',
    endedAt: '2026-10-02T09:55:00Z',
    decisions: [{ ref: card.ref, text: 'Seguir com o merge hoje', target: 'spec', dest: `${plan} › Registro` }],
    effects: [{ ref: card.ref, text: 'Abrir MR', repo: 'sz4' }],
    unanswered: [{ ref: card.ref, question: 'Pode subir?' }],
    transcript: [{ who: 'Luiz', text: 'bom dia', at: '09:40' }],
  };
  await grab('teams', () => agents.teamsText(minutes, [card, bare]));
  await grab('release-comment', () => agents.rewriteQaComment(15499, 'comentário atual', 'saída do sync', { issue: 15499 }));
  await grab('conflict-ask', () => agents.conflictAsk('contexto do conflito', 'qual lado fica?', null));
  await grab('conflict-ask-resumed', () => agents.conflictAsk('contexto do conflito', 'e o outro?', 'sess-c'));
  await grab('conflict-propose', () =>
    agents.conflictPropose({ issue: 15499, title: card.title, mr: 'sz4!797', branch: 'release/bugfix/15499', worktree: '/tmp/wt', hunks: [{ id: 'h1', file: 'a.ts', ours: 'x', base: null, theirs: 'y' }] }),
  );

  let started: { id: string } | null = null;
  await grab('gate-start', async () => (started = await gate.startGate(card, 1)));
  const id = (started as unknown as { id: string }).id;
  await grab('gate-answer-free', () => gate.answerGate(id, 0, { text: 'o cache é invalidado' }));
  await grab('gate-explain', () => gate.explainGate(id, 'me explica a seção')) ;
  await grab('gate-visual', () => gate.visualGate(id));
  gate.insertGateVisual(id);
  await grab('gate-round', () => gate.newGateRound(id));
  gate.recordGate(id);
  const quiz = join(folder, 'bug', 'GATE_QUIZ.md');
  files['bug/GATE_QUIZ.md'] = readFileSync(quiz, 'utf8').replace(/\(\d{4}-\d{2}-\d{2}\)/g, '(DATE)');
  files['bug/1_INVESTIGATION.md'] = readFileSync(join(folder, 'bug', '1_INVESTIGATION.md'), 'utf8').replace(/\d{4}-\d{2}-\d{2}/g, 'DATE');

  await grab('qa-prepare', () => qa.prepareQa(card));
  await grab('qa-ask', () => qa.askQa(card.iid, 'onde testo?'));
  qa.writeQaChecklist(card.iid);
  files['QA_CHECKLIST.md'] = readFileSync(join(folder, 'QA_CHECKLIST.md'), 'utf8').replace(/\d{4}-\d{2}-\d{2}/g, 'DATE');

  await grab('retro', () => retro.prepareRetro());
  const retroId = (await import('../../src/main/retro')).latestRetro()?.id ?? '';
  await grab('retro-ask', () => retro.askRetro(retroId, 'o que travou?'));

  await grab('reentry', () => feedback.prepareReentry(card));
  await grab('reentry-ask', () => feedback.askReentry(card.iid, 'e agora?'));
  await grab('discussion', () => feedback.explainDiscussion(card, card.mrPaths[0], 'abcdef12'));

  const saved = await store.saveMinutes(minutes, 'texto do teams', [0]);
  files['plan-after-registro'] = readFileSync(plan, 'utf8');
  prompts['save-result'] = { role: 'store', prompt: JSON.stringify(saved.written), system: '', maxTurns: null, resume: null, allowedTools: [], extraDirs: [], schemaKeys: [] };
  // Machine-specific paths out, so the same run on another machine gives the same text.
  const text = JSON.stringify({ prompts, files }).split(specsDir).join('<SPECS>').split(process.env.CERIMONIAS_DATA_DIR as string).join('<DATA>');
  return JSON.parse(text) as Scenario;
}

/** The prompts of the ceremonies every template has (the daily preparation, the unblock conversation, the summary and the retro). */
export async function runBasics(ref = 'sz4#15499'): Promise<Record<string, Captured>> {
  const agents = await import('../../src/main/agents');
  const retro = await import('../../src/main/retro');
  const card = cardFixture('/nowhere', '/nowhere/plan.md', { ref, iid: ref.split('#').pop() as string, spec: null, blockers: [], pending: [] });
  const prompts: Record<string, Captured> = {};
  const grab = async (name: string, fn: () => Promise<unknown>) => {
    const before = calls.length;
    await fn();
    calls.slice(before).forEach((c, i, all) => (prompts[all.length > 1 ? `${name}#${i + 1}` : name] = c));
  };
  const turn = { ref: card.ref, sessionId: null, speech: 'Spoke.', did: 'a', next: 'b', blocker: null, question: null };
  await grab('turn', () => agents.prepareTurn(card));
  await grab('reply', () => agents.reply(card, turn, 'go ahead'));
  await grab('deep', () => agents.deepAsk(card, 'why does it fail?', null));
  await grab('deep-options', () => agents.deepOptions(card, 'sess-deep'));
  await grab('teams', () => agents.teamsText({ startedAt: '2026-10-02T09:40:00Z', endedAt: '2026-10-02T09:55:00Z', decisions: [], effects: [], unanswered: [], transcript: [] }, [card]));
  await grab('retro', () => retro.prepareRetro());
  return prompts;
}
