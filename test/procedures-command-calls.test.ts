// The command draft through the real call paths (#187): a working stage with a sandbox and an agent answering in a conversation with a shell, each over the real procedure port
// in a temp folder, with the fake sandbox and the fake engine. What the draft holds is the commands the agent ran itself: not the app's own, not an earlier answer's.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { setLanguage } from '../src/shared/i18n';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { AgentCall } from '../src/main/agents';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { answerMentions, type MentionDeps } from '../src/main/mentions/answer';
import { createKeptSessions } from '../src/main/mentions/kept';
import { createCallStops } from '../src/main/mentions/stop';
import type { MentionPlace } from '../src/main/mentions/place';
import { createProceduresPort } from '../src/main/procedures/port';
import { prompt as cycleWords } from '../src/main/cyclePrompts';
import { getConfig } from '../src/main/workspaceConfig';
import { type FakeSandbox, boot, doc, fakeEngine, fakeSandbox, work } from './helpers/runner';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

vi.setConfig({ testTimeout: 60_000 });

let root: string;
let forum: ForumStore;
let screens: FakeScreens | undefined;

beforeEach(() => {
  setLanguage('en');
  root = mkdtempSync(join(tmpdir(), 'coxia-procedures-cmd-calls-'));
  forum = createForumStore(join(root, 'forum'));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
});
afterEach(() => {
  setLanguage('pt-BR');
  screens?.dispose();
  screens = undefined;
  rmSync(root, { recursive: true, force: true });
});

const text = (r: { text: string } | undefined): string => r?.text ?? '';
/** `npm test` fails and the same program then works with a flag: the trial and error a draft keeps. */
const TABLE = { 'npm test': { exitCode: 1 } };

describe('a working stage with a sandbox', () => {
  it('drafts the commands the agent ran, not the ones the app ran before it', async () => {
    const b = await boot({
      procedures: createProceduresPort({ config: getConfig, dir: root }),
      sandbox: fakeSandbox({ table: TABLE }),
      configure: (c) => {
        c.language = 'en';
        c.runner.procedures = true;
        c.agents.team.find((a) => a.id === 'qa')!.shell = 'sandbox';
        c.runner.commands = ['node probe.js'];
      },
    });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
    b.engine.script('developer', () => work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] }));
    b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    let drafted = '';
    let tools: AgentCall['procedures'];
    b.engine.script('qa', async (call) => {
      tools = call.procedures;
      await call.exec?.exec('npm ci');
      await call.exec?.exec('npm test');
      await call.exec?.exec('npm test -- --runInBand');
      drafted = text(await call.procedures?.draft?.({}));
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [] });
    });
    let run = await b.runner.start('101');
    for (let i = 0; i < 40; i++) {
      await b.settle();
      run = b.runner.get(run.id)!;
      if (run.status === 'gate') b.runner.gate(run.id, 'approve');
      else if (run.stage === 'ready' || run.status === 'done') break;
    }
    expect(tools?.draft).toBeTypeOf('function');
    expect(tools?.has).toEqual({ screen: false, commands: true });
    expect(drafted).toMatch(/^Draft c-1\./);
    expect(drafted).toContain('run: npm ci');
    expect(drafted).toContain('run: npm test -- --runInBand');
    expect(drafted).toContain('Failed (exit 1): Run npm test');
    expect(drafted).not.toContain('node probe.js');
    // The agent of a stage with no shell is given no draft: the other stages of the run had none to make.
    const developer = b.engine.calls.find((c) => c.agent.id === 'developer');
    expect(developer?.procedures?.draft).toBeUndefined();
    // The rules about commands are told to the stage that has a shell and to no other, and the screen rule to neither (no browser).
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa');
    expect(qa?.system).toContain(cycleWords('runner.rules.procedures'));
    expect(qa?.system).toContain(cycleWords('runner.rules.proceduresCmd'));
    expect(qa?.system).not.toContain(cycleWords('runner.rules.proceduresGui'));
    expect(developer?.system).not.toContain(cycleWords('runner.rules.proceduresCmd'));
  });
});

describe('an agent answering in a conversation with a shell', () => {
  const place = (): MentionPlace => ({ thread: 'squads', kind: 'channel', squad: null, repos: [], ref: 'app#7', title: 'The thing' });
  const say = () => forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn do it', mentions: ['turn'] })[0];
  const config = (agent: Record<string, unknown> = {}): WorkspaceConfig => {
    const c = neutralConfig();
    c.language = 'en';
    c.runner.sandbox.display = true;
    c.runner.procedures = true;
    c.agents.team = c.agents.team.map((a) => (a.id === 'turn' ? { ...a, permission: 'read' as const, shell: 'sandbox' as const, screen: true, allowedHosts: ['docs.example.com'], ...agent } : { ...a, permission: 'read' as const, shell: 'none' as const }));
    return c;
  };
  const withDisplay = (): FakeSandbox => fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/s/x11/X99', kind: 'sandbox' }, table: TABLE });

  function world(agent: Record<string, unknown> = {}, over: Partial<MentionDeps> = {}) {
    const engine = fakeEngine();
    const c = config(agent);
    const d: MentionDeps = {
      forum,
      config: () => c,
      sandbox: withDisplay(),
      env: () => ({ fallbackCwd: root }),
      screens: () => ({ sessions: screens!.sessions, asks: screens!.asks }),
      kept: createKeptSessions(),
      stops: createCallStops(),
      procedures: createProceduresPort({ config: () => c, dir: root }),
      engine,
      ...over,
    };
    return { d, engine };
  }

  it('drafts only the commands of this answer when the session is kept between answers', async () => {
    screens = fakeScreens();
    const { d, engine } = world();
    let first = '';
    let second = '';
    engine.script('turn', async (call) => {
      if (engine.calls.length === 1) {
        await call.exec?.exec('npm ci');
        first = text(await call.procedures?.draft?.({}));
        return { text: 'First.' };
      }
      await call.exec?.exec('npm test');
      await call.exec?.exec('npm test -- --runInBand');
      second = text(await call.procedures?.draft?.({}));
      return { text: 'Second.' };
    });
    await answerMentions(place(), say(), d);
    await answerMentions(place(), say(), d);
    expect(first).toContain('run: npm ci');
    expect(second).toContain('run: npm test -- --runInBand');
    expect(second).toContain('Failed (exit 1): Run npm test');
    expect(second).not.toContain('npm ci');
  });

  it('offers the draft to an agent with a shell and no browser, and says so in the rules by the screen only for an agent that has one', async () => {
    screens = fakeScreens();
    const gui = cycleWords('runner.rules.proceduresGui');
    const { d, engine } = world({ screen: false });
    engine.script('turn', async (call) => {
      await call.exec?.exec('npm ci');
      return { text: 'Done.' };
    });
    // A place with a repository on disk: the agent without a browser works in a copy of it.
    const path = join(root, 'repos', 'api');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'README.md'), '# api\n');
    await answerMentions({ ...place(), repos: [{ id: 'api', path, remoteUrl: null, vcsId: null, projectPath: 'group/api' }] }, say(), d);
    const call = engine.calls[0];
    expect(call.procedures?.draft).toBeTypeOf('function');
    expect(call.procedures?.has).toEqual({ screen: false, commands: true });
    // The screen rule is about the app's browser: an agent without one is not told to draft a site. The commands rule is told to the one with a shell.
    expect(call.system).not.toContain(gui);
    expect(call.system).toContain(cycleWords('runner.rules.proceduresCmd'));
  });

  it('tells both rules to an agent with a shell and a browser, and only the screen rule to one with a browser alone', async () => {
    screens = fakeScreens();
    const both = world();
    both.engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions(place(), say(), both.d);
    expect(both.engine.calls[0].procedures?.has).toEqual({ screen: true, commands: true });
    expect(both.engine.calls[0].system).toContain(cycleWords('runner.rules.proceduresGui'));
    expect(both.engine.calls[0].system).toContain(cycleWords('runner.rules.proceduresCmd'));
    const browserOnly = world({ shell: 'none' });
    browserOnly.engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions(place(), say(), browserOnly.d);
    expect(browserOnly.engine.calls[0].procedures?.has).toEqual({ screen: true, commands: false });
    expect(browserOnly.engine.calls[0].system).toContain(cycleWords('runner.rules.proceduresGui'));
    expect(browserOnly.engine.calls[0].system).not.toContain(cycleWords('runner.rules.proceduresCmd'));
  });

  it('has no draft for an agent with neither a shell nor a browser, no rule about one, and none in a ceremony', async () => {
    screens = fakeScreens();
    const bare = world({ shell: 'none', screen: false });
    bare.engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions(place(), say(), bare.d);
    expect(bare.engine.calls[0].procedures).toBeDefined();
    expect(bare.engine.calls[0].procedures?.draft).toBeUndefined();
    expect(bare.engine.calls[0].system).not.toContain(cycleWords('runner.rules.proceduresCmd'));
    expect(bare.engine.calls[0].system).not.toContain(cycleWords('runner.rules.proceduresGui'));

    const ceremony = world();
    ceremony.engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions({ ...place(), kind: 'ceremony' } as MentionPlace, say(), ceremony.d);
    expect(ceremony.engine.calls[0].procedures).toBeUndefined();
  });
});
