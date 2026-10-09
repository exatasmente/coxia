// What an agent is told about its screen, its hosts and the app's browser (#177, rule 45, acceptance 23). An agent with none of the switches gets today's prompt, byte for byte
// (the golden file was made with the code as it was before these texts existed); an agent with the screen, or a host list, gets the variants that read its own settings.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import type { ForumMessage } from '../src/shared/forum';
import { CATALOGS } from '../src/shared/i18n';
import { startRun } from '../src/shared/runs';
import { promptFor } from '../src/main/browser/callScreen';
import { grantsFor } from '../src/main/browser/guard';
import { mentionCall } from '../src/main/mentions/call';
import { type StageInput, systemText } from '../src/main/runner/prompt';
import { type ScreenPrompt, refusalText, screenPromptOf } from '../src/main/runner/screenPrompt';
import { updateConfig } from '../src/main/workspaceConfig';
import { agentFlowConfig, agentFlowStages, at, startInput } from './helpers/runs';

const GOLDEN = join(import.meta.dirname, 'golden', 'screen-off-prompts.json');
const flow = agentFlowStages();
const run = startRun(startInput(), flow, at(0)).run;

function configFor(language: 'en' | 'pt-BR', network: 'off' | 'registry' | 'open' = 'off'): WorkspaceConfig {
  const c = agentFlowConfig();
  c.language = language;
  c.runner.sandbox.network = network;
  c.runner.sandbox.registryHosts = ['registry.example.com'];
  return c;
}

function stageInput(config: WorkspaceConfig, agent: AgentDef, over: Partial<StageInput> = {}): StageInput {
  const stage = flow.find((s) => s.agent === agent.id) ?? flow[0];
  return {
    run,
    stage,
    agent,
    config,
    kind: 'work',
    writes: false,
    commands: [],
    files: [],
    memory: null,
    thread: [],
    attempt: 1,
    handoff: null,
    answer: null,
    diff: null,
    ...over,
  };
}

const postOf = (text: string): ForumMessage => ({ v: 1, type: 'message', seq: 3, thread: 'general', at: '2026-10-03T10:00:00.000Z', kind: 'post', author: { type: 'person' }, text, code: null, params: {}, mentions: ['developer'], refs: [], attachments: [], stage: null, to: null, replyTo: null, public: false, waitsForAnswer: false, published: null });

const gui = { browsers: '/b', display: 'on' as const, out: '/coxia/out' };

/** Every prompt an agent with none of the switches can get, in both languages, for the sandbox and the host, with and without the browsers and the display. */
function offCases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const language of ['en', 'pt-BR'] as const) {
    for (const network of ['off', 'registry', 'open'] as const) {
      const config = configFor(language, network);
      updateConfig(() => config);
      const agent = config.agents.team.find((a) => a.id === 'developer') as AgentDef;
      out[`${language} stage ${network} sandbox reader gui`] = systemText(stageInput(config, agent, { sandbox: { network, reader: true, gui, look: true } }));
      out[`${language} stage ${network} sandbox writer`] = systemText(stageInput(config, agent, { writes: true, sandbox: { network, reader: false } }));
      out[`${language} stage ${network} none`] = systemText(stageInput(config, agent));
            for (const shell of [undefined, { host: false, network }, { host: true, network }]) {
        out[`${language} mention ${network} ${shell ? (shell.host ? 'host' : 'sandbox') : 'no shell'}`] = mentionCall({ agent, config, message: postOf('@developer look'), thread: [], files: [], cwd: '/tmp', place: 'general', ...(shell ? { shell } : {}) }).system ?? '';
      }
    }
    const config = configFor(language);
    updateConfig(() => config);
    const agent = config.agents.team.find((a) => a.id === 'developer') as AgentDef;
    out[`${language} stage host gui`] = systemText(stageInput(config, agent, { sandbox: { network: 'off', reader: true, host: true, gui: { browsers: null, display: 'on', out: '/home/p/out' }, look: false } }));
  }
  return out;
}

beforeAll(() => {
  // The golden is made once, with the code as it stood before this commit; a deliberate change of one of these prompts regenerates it with UPDATE_GOLDEN=1.
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(offCases(), null, 1)}\n`);
});

describe('an agent with none of the switches', () => {
  it('gets the prompt it got before, byte for byte', () => {
    const want = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
    const got = offCases();
    expect(Object.keys(got)).toEqual(Object.keys(want));
    for (const [name, text] of Object.entries(want)) expect(got[name], name).toBe(text);
  });

  it('has no screen facts at all, whatever the workspace and the call', () => {
    const config = configFor('en', 'registry');
    const agent = config.agents.team.find((a) => a.id === 'developer') as AgentDef;
    expect(promptFor(null, agent, config.runner.sandbox, grantsFor(agent), true)).toBeUndefined();
    expect(screenPromptOf({ agent: { ...agent, shell: 'host' }, workspace: config.runner.sandbox, allowedHosts: ['app.example.com'], browser: null, display: false, confirm: true })).toBeUndefined();
  });
});

const agentWith = (config: WorkspaceConfig, over: Partial<AgentDef>): AgentDef => ({ ...(config.agents.team.find((a) => a.id === 'developer') as AgentDef), ...over });
const tools = ['browser_navigate', 'browser_snapshot', 'browser_click'];
const lease = (profile: 'own' | 'fresh' | 'none' = 'none') => ({ tools, profile });

describe('an agent with the screen', () => {
  const setup = (language: 'en' | 'pt-BR', network: 'off' | 'registry' | 'open' = 'off') => {
    const config = configFor(language, network);
    updateConfig(() => config);
    return config;
  };

  it('is told the app\'s browser is the way to an external site, which tools it has, that the app holds some steps, and that its own Playwright is for the app under test', () => {
    const config = setup('en');
    const agent = agentWith(config, { screen: true, shell: 'sandbox', allowedHosts: ['app.example.com'] });
    const screen = screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: ['app.example.com'], browser: lease('own'), display: true, confirm: true }) as ScreenPrompt;
    const text = systemText(stageInput(config, agent, { sandbox: { network: 'off', reader: true, gui, look: true }, screen }));
    expect(text).toContain('You have the app\'s browser, and it is the way to work on any external site');
    expect(text).toContain('Its tools are browser_navigate, browser_snapshot, browser_click.');
    expect(text).toContain('asks the person before it happens');
    expect(text).toContain('Playwright from your shell, if you have one, is for the app under test on 127.0.0.1');
    expect(text).toContain('The sites you may reach: app.example.com.');
    expect(text).toContain('Your browser keeps its logins');
    expect(text).toContain('share one virtual display');
    expect(text).toContain('call screen_confirm');
    // The sentences that said there is no network and no external address are replaced by the ones that fit.
    expect(text).not.toContain('There is no network: never open an external address.');
    expect(text).toContain('an external site is worked through the app\'s browser tools');
    expect(text).toContain('a filtering proxy that lets HTTPS (port 443) through to these hosts and to no others: app.example.com');
    expect(text).not.toContain('{');
  });

  it('says in the same words in Portuguese', () => {
    const config = setup('pt-BR');
    const agent = agentWith(config, { screen: true, shell: 'none' });
    const screen = screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: [], browser: lease('none'), display: false, confirm: true }) as ScreenPrompt;
    const text = systemText(stageInput(config, agent, { screen }));
    expect(text).toContain('Você tem o navegador do app');
    expect(text).toContain('Você não tem nenhum site que possa alcançar');
    expect(text).toContain('Seu navegador começa limpo a cada vez');
    expect(text).not.toContain('{');
  });

  it('is told, with no shell and no hosts, that every address is refused; and the registry hosts are its hosts when the workspace shares the registry', () => {
    const off = setup('en', 'off');
    const agent = agentWith(off, { screen: true, shell: 'none' });
    const none = systemText(stageInput(off, agent, { screen: screenPromptOf({ agent, workspace: off.runner.sandbox, allowedHosts: [], browser: lease(), display: false, confirm: false }) }));
    expect(none).toContain('You have no site you may reach: every address is refused.');
    const reg = setup('en', 'registry');
    const withRegistry = systemText(stageInput(reg, agent, { screen: screenPromptOf({ agent, workspace: reg.runner.sandbox, allowedHosts: ['app.example.com'], browser: lease(), display: false, confirm: false }) }));
    expect(withRegistry).toContain('The sites you may reach: registry.example.com, app.example.com.');
  });

  it('is told its browser is the computer\'s own network when its shell runs there, and the host variant of the testing text', () => {
    const config = setup('en');
    const agent = agentWith(config, { screen: true, shell: 'host', allowedHosts: ['ignored.example.com'] });
    const screen = screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: ['ignored.example.com'], browser: lease(), display: true, confirm: true }) as ScreenPrompt;
    expect(screen.ownHosts).toEqual([]);
    const text = systemText(stageInput(config, agent, { sandbox: { network: 'off', reader: true, host: true, gui: { browsers: null, display: 'on', out: '/home/p/out' } }, screen }));
    expect(text).toContain('Your browser uses the computer\'s own network');
    expect(text).toContain('an external site is worked through the app\'s browser tools, never by driving a browser from your shell');
    expect(text).not.toContain('ignored.example.com');
    expect(text).not.toContain('never drive a browser to an external one');
  });

  it.each([
    ['own', 'Your browser keeps its logins'],
    ['fresh', 'Your logged-in browser is in use by another screen of yours'],
    ['none', 'Your browser starts clean every time'],
  ] as const)('says what its profile is when the lease has a %s profile', (profile, sentence) => {
    const config = setup('en');
    const agent = agentWith(config, { screen: true, shell: 'none', browserProfile: profile !== 'none' });
    const text = systemText(stageInput(config, agent, { screen: screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: [], browser: lease(profile), display: false, confirm: false }) }));
    expect(text).toContain(sentence);
  });

  it('is told why it has no browser, and not to reach a site any other way', () => {
    const config = setup('en');
    const agent = agentWith(config, { screen: true, shell: 'sandbox' });
    const reason = refusalText('no-browsers', 'unset');
    const screen = screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: [], browser: { refusal: reason }, display: false, confirm: true }) as ScreenPrompt;
    const text = systemText(stageInput(config, agent, { sandbox: { network: 'off', reader: true }, screen }));
    expect(text).toContain(`You do not have the app's browser in this conversation: ${reason}.`);
    expect(text).toContain('no folder of browsers is set');
    expect(text).not.toContain('Its tools are');
  });
});

describe('an agent with a host list and no screen', () => {
  it('is told the hosts its proxy reaches, with the registry\'s when the workspace shares it, and nothing about a browser', () => {
    const config = configFor('en', 'registry');
    updateConfig(() => config);
    const agent = agentWith(config, { allowedHosts: ['app.example.com'], shell: 'sandbox' });
    const screen = screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: ['app.example.com'], browser: null, display: false, confirm: true }) as ScreenPrompt;
    const text = systemText(stageInput(config, agent, { writes: true, sandbox: { network: 'registry', reader: false }, screen }));
    expect(text).toContain('lets HTTPS (port 443) through to these hosts and to no others: registry.example.com, app.example.com.');
    expect(text).not.toContain('The only network is the package registry');
    expect(text).not.toContain("app's browser");
    expect(text).toContain('call screen_confirm');
  });

  it('gets the same in a mention call, which has no testing text of its own', () => {
    const config = configFor('en');
    updateConfig(() => config);
    const agent = agentWith(config, { allowedHosts: ['app.example.com'], shell: 'sandbox' });
    const screen = screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: ['app.example.com'], browser: null, display: false, confirm: true }) as ScreenPrompt;
        const call = mentionCall({ agent, config, message: postOf('@developer look'), thread: [], files: [], cwd: '/tmp', place: 'general', shell: { host: false, network: 'off' }, screen });
    expect(call.system).toContain('through to these hosts and to no others: app.example.com');
    expect(call.system).toContain('call screen_confirm');
  });
});

describe('a mention call of an agent with the screen', () => {
  it('includes the same sections, with or without a shell', () => {
    const config = configFor('en');
    updateConfig(() => config);
    const agent = agentWith(config, { screen: true, shell: 'none' });
    const screen = screenPromptOf({ agent, workspace: config.runner.sandbox, allowedHosts: [], browser: lease(), display: false, confirm: true }) as ScreenPrompt;
        const call = mentionCall({ agent, config, message: postOf('@developer look'), thread: [], files: [], cwd: '/tmp', place: 'general', screen });
    expect(call.system).toContain('You have the app\'s browser');
    expect(call.system).not.toContain('Shell tool');
  });
});

describe('the catalogs', () => {
  const keys = Object.keys(CATALOGS.en).filter((k) => /^prompt\.sdd\.runner\.rules\.(screen|shell\.hosts|gui\.screen|gui\.host\.screen)/.test(k));
  it('have every new text in both languages, with the same placeholders', () => {
    expect(keys.length).toBeGreaterThanOrEqual(13);
    const holes = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      expect(CATALOGS['pt-BR'][k], k).toBeTruthy();
      expect(holes(CATALOGS['pt-BR'][k]), k).toEqual(holes(CATALOGS.en[k]));
    }
  });
});
