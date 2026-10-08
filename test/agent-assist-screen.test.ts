// The agent assistant's screen and the editor it opens, as static markup: what a person sees at each step, which buttons there are, and what the editor shows when it
// comes from the assistant. There is no DOM library in this repository, so what moves (a click, a call to the model) is covered by the pure state in
// agent-assist-state.test.ts and the channels in agent-assist-module.test.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { ASSIST_LIMITS, MINIMUM_SETTINGS, type AssistQuestion } from '../src/shared/agentAssist';
import { setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
// useT subscribes with useSyncExternalStore, which has no server snapshot: a static render reads the translator directly.
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
// The conversation reads the activity of the app from the window while it loads; here it is only a marker of the thread it was given.
vi.mock('../src/renderer/src/screens/cycle/Thread', () => ({ Thread: (p: { thread: string; title?: string }) => createElement('div', { 'data-thread': p.thread, 'data-title': p.title }) }));
const { AgentAssist } = await import('../src/renderer/src/screens/team/AgentAssist');
const { AgentPanel, TeamSection } = await import('../src/renderer/src/screens/team/TeamSection');
const { blankAgent, draftOf } = await import('../src/renderer/src/screens/team/agentEdit');
const { startAssist, toAgentDraft, withAnswer, withReview, withRound } = await import('../src/renderer/src/screens/team/assistEdit');
type AssistState = ReturnType<typeof startAssist>;

/** Sets the marker the app writes on the document root when the build is the browser one. */
function asWeb(web: boolean): void {
  (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document = { documentElement: { dataset: web ? { platform: 'web' } : {} } };
}

beforeEach(() => {
  setLanguage('en');
  asWeb(false);
});
afterEach(() => setLanguage('pt-BR'));

const flow = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlow);
const withTrial = (): WorkspaceConfig => {
  const c = flow();
  c.agents.team.push(newAgent({ id: 'trial', name: 'Trial agent', draft: true }));
  return c;
};

const open: AssistQuestion = { id: 'q1', text: 'What should it never touch?', kind: 'open', options: [], why: 'A limit the agent keeps.' };
const single: AssistQuestion = { id: 'q2', text: 'Which repository does it read?', kind: 'single', options: ['api', 'web'], why: 'It sets the code it reads.' };
const multi: AssistQuestion = { id: 'q3', text: 'Which labels does it triage?', kind: 'multi', options: ['bug', 'feature'], why: 'It sets what it picks up.' };
const draft = { name: 'Triager', job: 'Triages new issues', instructions: 'Read the issue and say what is missing.' };

const asking = (over: Partial<AssistState> = {}): AssistState => ({ ...withRound({ ...startAssist(), request: 'triage issues' }, { questions: [open, single, multi], draft, enough: false }), ...over });

const view = (state: AssistState, config: WorkspaceConfig = flow()): string =>
  renderToStaticMarkup(createElement(AgentAssist, { config, state, update: () => undefined, reload: () => undefined, onConclude: () => undefined, onClose: () => undefined }));

const reviewed = (settings = MINIMUM_SETTINGS, reasons = {}, base: AssistState = startAssist()): AssistState => withReview({ ...base, request: 'triage issues' }, { draft, settings, reasons });

const has = (html: string, text: string): boolean => html.includes(text.replace(/&/g, '&amp;'));
const buttonLabels = (html: string): string[] => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

describe('the request', () => {
  it('asks what the agent should do, and offers nothing else yet', () => {
    const html = view(startAssist());
    expect(html).toContain('Create an agent with AI');
    expect(html).toContain('What should this agent do?');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Write the questions/);
    expect(html).toContain(`maxLength="${ASSIST_LIMITS.request}"`);
    expect(html).not.toContain('Round 1 of');
  });

  it('asks what to change when an agent is being adjusted, and names it', () => {
    const html = view(startAssist({ ...blankAgent(), id: 'triager', name: 'Triager' }));
    expect(html).toContain('Adjust Triager with AI');
    expect(html).toContain('What do you want to change?');
    expect(html).not.toContain('What should this agent do?');
  });

  it('lets the person write the request, and then generate the questions', () => {
    const html = view({ ...startAssist(), request: 'triage the new issues' });
    expect(html).toContain('triage the new issues');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Write the questions/);
  });

  it('marks the step the person is on, and only that one', () => {
    const html = view(startAssist());
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step">Request</);
    expect(html).toMatch(/>Questions</);
    expect(html).toMatch(/>Review</);
    expect(html).toMatch(/>Test</);
  });
});

describe('a round of questions', () => {
  it('shows every kind of question with Other on the choices, the reason of each, and the draft so far', () => {
    const html = view(asking());
    expect(html).toContain('Round 1 of 4');
    expect(html).toContain(open.text);
    expect(html).toContain(single.text);
    expect(html).toContain(multi.text);
    // an open question is a text box; a single choice is radio buttons and a multiple choice is boxes, each with Other
    expect(html).toMatch(/<textarea[^>]*maxLength="600"/);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/<span>Other<\/span>/g)).toHaveLength(2);
    expect(html).toContain('Why it matters: It sets the code it reads.');
    expect(html).toContain('Why it matters: A limit the agent keeps.');
    // the draft, kept in view and open
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toContain('Triager');
    expect(html).toContain('Read the issue and say what is missing.');
    // every question may stay without an answer, and nothing on screen is an answer yet
    expect(html).toContain('a question without an answer is a skipped question');
    expect(html).not.toContain('Clear the answer');
  });

  it('offers the next round and Finish, with the next round as the main button', () => {
    const labels = buttonLabels(view(asking()));
    expect(labels).toContain('Next round');
    expect(labels).toContain('Finish');
    expect(view(asking())).toMatch(/btn btn-dark"[^>]*>(<span[^>]*><\/span>)?\s*Next round/);
  });

  it('shows what was answered, and a way to clear it', () => {
    const state = asking();
    const answered = { ...state, open: withAnswer(state.open!, { question: 'q2', picked: ['web'], other: '', text: '' }) };
    const html = view(answered);
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*\/><span>web<\/span>/);
    expect(html).toContain('Clear the answer');
  });

  it('has no next round after the fourth, and says so', () => {
    const fourth = withRound({ ...asking(), rounds: [asking().open!, asking().open!, asking().open!] }, { questions: [open], draft, enough: false });
    const html = view(fourth);
    expect(html).toContain('Round 4 of 4');
    expect(buttonLabels(html)).not.toContain('Next round');
    expect(buttonLabels(html)).toContain('Finish');
    expect(html).toContain('That was the last of 4 rounds');
  });

  it('has no next round when the model says it has nothing more to ask, and makes Finish the main button', () => {
    const html = view({ ...asking(), enough: true });
    expect(buttonLabels(html)).not.toContain('Next round');
    expect(html).toContain('Nothing more to ask');
    expect(html).toMatch(/btn btn-dark"[^>]*>(<span[^>]*><\/span>)?\s*Finish/);
  });

  it('says nothing usable came, and offers to try again or to go on with what exists', () => {
    const html = view(asking({ open: { questions: [], answers: [] } }));
    expect(html).toContain('did not bring any question that can be used');
    expect(buttonLabels(html)).toEqual(expect.arrayContaining(['Try again', 'Go on with what exists']));
    expect(buttonLabels(html)).not.toContain('Next round');
  });
});

describe('the review', () => {
  const proposed = { ...MINIMUM_SETTINGS, tracker: 'read' as const, stages: ['implement'], turnsTo: 'tech-lead' };
  const reasons = { tracker: 'It reads the issue before it answers.', stages: 'It works the implementation.', turnsTo: 'It asks the lead first.' };

  it('lets the person edit the three texts, with the limits of the editor', () => {
    const html = view(reviewed(proposed, reasons));
    expect(html).toContain('value="Triager"');
    expect(html).toContain('Triages new issues');
    expect(html).toContain('Read the issue and say what is missing.');
    expect(html).toContain(`maxLength="${ASSIST_LIMITS.name}"`);
    expect(html).toContain(`maxLength="${ASSIST_LIMITS.job}"`);
    expect(html).toContain(`maxLength="${ASSIST_LIMITS.instructions}"`);
  });

  it('lists each value above the minimum with its reason and a button that puts it back, and nothing else', () => {
    const html = view(reviewed(proposed, reasons));
    expect(html).toContain('Above the minimum');
    for (const reason of Object.values(reasons)) expect(html).toContain(`Reason: ${reason}`);
    expect(html.match(/Back to the minimum/g)).toHaveLength(3);
    // what stayed at the minimum is not listed
    expect(html).not.toContain('<strong>Permission</strong>');
    expect(html).not.toContain('<strong>Commands</strong>');
    expect(html).toContain('<strong>Code host</strong>');
    expect(html).toContain('<strong>Turns to</strong>');
  });

  it('says there is nothing above the minimum when there is not', () => {
    const html = view(reviewed());
    expect(html).toContain('Nothing goes past the minimum');
    expect(html).not.toContain('Back to the minimum');
  });

  it('warns beside a permission to write that the test does not show what the agent does with files', () => {
    const w = view(reviewed({ ...MINIMUM_SETTINGS, permission: 'worktree' }, { permission: 'It edits files.' }));
    expect(w).toContain('in a conversation the agent never changes files');
    expect(w).toContain('role="note"');
    expect(view(reviewed(proposed, reasons))).not.toContain('never changes files');
  });

  it('shows no host, autonomy, command or model of its own', () => {
    const html = view(reviewed({ ...MINIMUM_SETTINGS, shell: 'sandbox' }, { shell: 'It runs the tests.' }));
    expect(html).not.toMatch(/Runs on this computer|Autonomy|Runs by itself|Always allowed/);
    expect(html).not.toMatch(/<select/);
  });

  it('warns when the model gave no name, and offers to test and to conclude', () => {
    const state = reviewed();
    const noName = { ...state, draft: { ...state.draft, name: '' } };
    expect(view(noName)).toContain('The AI did not give a name');
    expect(view(state)).not.toContain('The AI did not give a name');
    expect(buttonLabels(view(state))).toEqual(expect.arrayContaining(['Test in a conversation', 'Conclude']));
  });

  it('adjusting, shows before and after, and goes back to what the agent was', () => {
    const form = { ...blankAgent(), id: 'triager', name: 'Triager', job: 'Triage', instructions: 'Old.', tracker: 'read' as const };
    const base = startAssist(form);
    const html = view(withReview({ ...base, request: 'less access' }, { draft: { name: 'Triager', job: 'Triage', instructions: 'New.' }, settings: { ...MINIMUM_SETTINGS, tracker: 'none' }, reasons: { tracker: 'It never needs the host.' } }), flow());
    expect(html).toContain('What changes in the agent');
    expect(html).toContain('Read only → No reading');
    expect(html).toContain('Back to what it was');
    expect(html).not.toContain('Back to the minimum');
    // the instructions it replaced are one click away
    expect(html).toContain('Before');
    expect(html).toContain('Old.');
  });
});

describe('the test', () => {
  const tested = (over: Partial<AssistState> = {}): AssistState => ({ ...reviewed(), step: 'test', testId: 'trial', ...over });

  it('puts the conversation of the draft agent in the panel, and offers to adjust from it, to go back and to conclude', () => {
    const html = view(tested(), withTrial());
    expect(html).toContain('data-thread="agent-trial"');
    expect(html).toContain('data-title="Trial agent"');
    expect(buttonLabels(html)).toEqual(expect.arrayContaining(['Adjust from this conversation', 'Back to the review', 'Conclude']));
    expect(html).toContain('What did you see go wrong? (optional)');
    expect(html).toContain('waits in Actions');
  });

  it('waits for the draft agent to be in the configuration before showing its conversation', () => {
    const html = view(tested(), flow());
    expect(html).not.toContain('data-thread');
    expect(html).toContain('Getting the conversation ready');
  });

  it('does not offer a fifth round from the test, and still concludes', () => {
    const four = { ...asking().open!, answers: [] };
    const html = view(tested({ rounds: [four, four, four, four] }), withTrial());
    expect(buttonLabels(html)).not.toContain('Adjust from this conversation');
    expect(buttonLabels(html)).toContain('Conclude');
    expect(html).toContain('All 4 rounds are used');
    // and with one left, it is offered
    expect(buttonLabels(view(tested({ rounds: [four, four, four] }), withTrial()))).toContain('Adjust from this conversation');
  });
});

describe('the editor the assistant opens', () => {
  const panel = (config: WorkspaceConfig, props: Record<string, unknown>): string =>
    renderToStaticMarkup(createElement(AgentPanel, { config, save: async (c: WorkspaceConfig) => c, onClose: () => undefined, ...props } as never));

  const state = (): AssistState => reviewed({ ...MINIMUM_SETTINGS, stages: ['implement'] }, { stages: 'It works the implementation.' }, { ...startAssist(), testId: 'trial' });

  it('promotes the draft agent: its id is fixed, there is no Delete, and the stages are listed', () => {
    const c = withTrial();
    const html = panel(c, { initial: toAgentDraft(state()), isNew: false, assisted: true, promote: { id: 'trial' } });
    expect(html).toContain('Id: @trial');
    expect(html).not.toContain('maxLength="48"');
    expect(buttonLabels(html)).not.toContain('Delete');
    expect(buttonLabels(html)).toEqual(expect.arrayContaining(['Save', 'Cancel']));
    expect(html).toContain('The test agent becomes a member of the team when you save');
    expect(html).toContain('<legend class="wz-label">Stages</legend>');
    // the stages the flow offers are boxes, and the one the assistant proposed is checked
    expect(c.devCycle.stages.some((s) => s.id === 'implement')).toBe(true);
    expect(html).toMatch(/type="checkbox" checked=""[^>]*\/><span>[^<]*<\/span>/);
    // the title is the one of a new agent
    expect(html).toContain('New agent');
    expect(html).toContain('aria-label="New agent"');
  });

  it('opens on an agent being adjusted with the changes not saved yet, and the stages too', () => {
    const c = flow();
    const dev = c.agents.team.find((a) => a.id === 'developer')!;
    const html = panel(c, { initial: { ...draftOf(dev), job: 'Changed by the AI' }, isNew: false, assisted: true });
    expect(html).toContain('Changed by the AI');
    expect(html).toContain('<legend class="wz-label">Stages</legend>');
    expect(html).toContain('nothing of the agent changes until you save');
    expect(buttonLabels(html)).toContain('Delete');
    expect(html).not.toContain('Adjust with AI');
  });

  it('makes a new agent from what the assistant made when none was tested', () => {
    const html = panel(flow(), { initial: toAgentDraft({ ...state(), testId: null }, flow().agents.team.map((a) => a.id)), isNew: true, assisted: true });
    expect(html).toContain('The agent does not exist yet');
    expect(html).toContain('maxLength="48"');
    expect(html).toContain('<legend class="wz-label">Stages</legend>');
  });

  it('shows no stages and no note to an editor that did not come from the assistant, as before', () => {
    const c = flow();
    const dev = c.agents.team.find((a) => a.id === 'developer')!;
    const html = panel(c, { initial: draftOf(dev), isNew: false });
    expect(html).not.toContain('<legend class="wz-label">Stages</legend>');
    expect(html).not.toContain('Cancel goes back to the assistant');
    expect(html).not.toContain('Adjust with AI');
    expect(buttonLabels(html)).toContain('Delete');
  });

  it('offers Adjust with AI to an agent the person made, and to nobody else', () => {
    const c = flow();
    const dev = c.agents.team.find((a) => a.id === 'developer')!;
    const sys = c.agents.team.find((a) => a.id === 'deep')!;
    expect(dev.system).toBe(false);
    expect(buttonLabels(panel(c, { initial: draftOf(dev), isNew: false, onAssist: () => undefined }))).toContain('Adjust with AI');
    expect(buttonLabels(panel(c, { initial: draftOf(sys), isNew: false, onAssist: () => undefined }))).not.toContain('Adjust with AI');
    expect(buttonLabels(panel(c, { initial: blankAgent(), isNew: true }))).not.toContain('Adjust with AI');
  });
});

describe('the team list', () => {
  const list = (web: boolean): string => {
    asWeb(web);
    return renderToStaticMarkup(createElement(TeamSection, { config: flow(), save: async (c: WorkspaceConfig) => c, reload: () => undefined } as never));
  };

  it('offers Create with AI beside New agent in the window', () => {
    const labels = buttonLabels(list(false));
    expect(labels).toEqual(expect.arrayContaining(['Create with AI', 'New agent']));
    expect(labels.indexOf('Create with AI')).toBeLessThan(labels.indexOf('New agent'));
  });

  it('keeps the assistant out of a paired browser, and the blank form as it was', () => {
    const labels = buttonLabels(list(true));
    expect(labels).not.toContain('Create with AI');
    expect(labels).toContain('New agent');
  });
});

describe('what the assistant says in Portuguese', () => {
  it('has the main texts in both languages', () => {
    setLanguage('pt-BR');
    const html = view(asking());
    expect(html).toContain('Rodada 1 de 4');
    expect(html).toContain('Próxima rodada');
    expect(html).toContain('Terminar');
    expect(html).toContain('Outro');
  });
});
