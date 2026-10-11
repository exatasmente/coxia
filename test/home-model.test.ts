// The home as plain functions and a scan of the sources: one constant is where the app opens and where every "back" goes, so which screen is the home is decided in one place.
// No component is rendered (the runner is a node environment), so the scan is how "every back asks for it" is held.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Run } from '../src/shared/runs';
import type { AgentTurn, Card, ReleaseAction } from '../src/shared/types';
import { needsYou, pendingQuestions } from '../src/renderer/src/dashboard';
import { type HomeCountsInput, HOME, OVERVIEW, blockedCards, ceremonyCard, deepBack, homeCounts, homeView, menuRows, resumeWizard, snoozeWizard, stripLabelKey, stripTarget, wizardSnoozed } from '../src/renderer/src/home';
import { agoraPlan, type AgoraInput } from '../src/renderer/src/dashboard';
import { waitingRuns } from '../src/shared/runs/view';
import type { WatcherAlert } from '../src/shared/watchers';
import { setLanguage, t } from '../src/shared/i18n';

const ROOT = join(import.meta.dirname, '..');
const sources = readdirSync(join(ROOT, 'src/renderer/src'), { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(ROOT, 'src/renderer/src', f), 'utf8') }));

describe('the home', () => {
  it('is the chat with the persona, and the Overview is the screen that holds what Today held', () => {
    expect(HOME).toEqual({ name: 'chat' });
    expect(OVERVIEW).toEqual({ name: 'overview' });
  });

  it('is where a deep dive goes back to unless it came from the pre-daily', () => {
    expect(deepBack('chat')).toBe(HOME);
    expect(deepBack('call')).toEqual({ name: 'call' });
  });
});

describe('the screens that go back to the start', () => {
  it('ask for the home and never name it, so the day the home changes no screen has to', () => {
    // The only place that writes the name of the screen that is the Overview: the home itself (the vocabulary of the targets and every screen use its constants).
    const naming = sources.filter((s) => /name: 'overview'/.test(s.text) && !s.file.endsWith('App.tsx')).map((s) => s.file).sort();
    expect(naming).toEqual(['home.ts']);
  });

  it('keep no screen called today: the name is the Overview\'s now', () => {
    expect(sources.filter((s) => /name: 'today'/.test(s.text)).map((s) => s.file)).toEqual([]);
    expect(sources.some((s) => s.file.endsWith('screens/Today.tsx'))).toBe(false);
    expect(sources.some((s) => s.file.endsWith('screens/Overview.tsx'))).toBe(true);
  });

  it('use the home in every screen that has a back button to the start, and import it', () => {
    const users = sources.filter((s) => !s.file.endsWith('home.ts') && /go\(HOME\)|back = HOME|\? HOME :|<Screen>\(HOME\)|: HOME;|\bHOME\)/.test(s.text));
    // the screens that returned to Today (and App, which opens on it): none of them calls a constant it does not import
    expect(users.length).toBeGreaterThanOrEqual(26);
    for (const s of users) expect(s.text, s.file).toMatch(/import \{[^}]*\bHOME\b[^}]*\} from '(\.\.\/)*(\.\/)?home'/);
  });
});

// ---- the chat that is not the home yet ------------------------------------------------------------------------------------------------------------------

const card = (iid: string, over: Partial<Card> = {}): Card => ({ ref: `g/p#${iid}`, iid, title: `Atividade ${iid}`, stage: 'Doing', spec: null, mrs: [], mrPaths: [], blockers: [], pending: [], changes: [], note: null, url: '', ...over });
const turn = (ref: string, over: Partial<AgentTurn> = {}): AgentTurn => ({ ref, sessionId: null, speech: '', did: '', next: '', blocker: null, question: null, ...over });
const action = (id: string, over: Partial<ReleaseAction> = {}): ReleaseAction => ({ id, key: id, kind: 'sync', issue: 1, issueTitle: 'T', state: 'pending', ...over }) as ReleaseAction;
const run = (ref: string, over: Partial<Run> = {}): Run => ({ id: `run-${ref}`, issue: { ref, title: 'T' }, status: 'working', createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z', ...over }) as unknown as Run;
const alert = (id: string, over: Partial<WatcherAlert> = {}): WatcherAlert => ({ id, kind: 'rejections', ref: 'g/p#1', iid: '1', title: 'T', message: 'M', detail: null, card: null, since: '2026-10-10T10:00:00Z', ...over });

describe('homeView', () => {
  const withTeam = (team: Array<{ id: string; kind?: 'persona'; draft?: true }>) => ({ agents: { team } }) as unknown as Parameters<typeof homeView>[0]['config'];

  it('waits for the configuration, opens the chat with a persona and the wizard without one', () => {
    expect(homeView({ config: null, snoozed: false })).toBe('loading');
    expect(homeView({ config: withTeam([{ id: 'persona', kind: 'persona' }]), snoozed: false })).toBe('chat');
    expect(homeView({ config: withTeam([{ id: 'dev' }]), snoozed: false })).toBe('wizard');
  });

  it('shows the Overview for the session when the person said "Not now", and the chat when there is a persona anyway', () => {
    expect(homeView({ config: withTeam([]), snoozed: true })).toBe('overview');
    expect(homeView({ config: withTeam([{ id: 'persona', kind: 'persona' }]), snoozed: true })).toBe('chat');
  });

  it('counts a persona draft that was never finished as none', () => {
    expect(homeView({ config: withTeam([{ id: 'persona-draft', kind: 'persona', draft: true }]), snoozed: false })).toBe('wizard');
  });
});

describe('the counts of the strip', () => {
  const cards = [card('1', { blockers: ['MR com conflitos'] }), card('2'), card('3'), card('4')];
  const input: HomeCountsInput = {
    cards,
    turns: { [cards[1].ref]: turn(cards[1].ref, { question: 'Which one?' }), [cards[2].ref]: turn(cards[2].ref, { question: 'And this?' }) },
    answered: { [cards[2].ref]: true },
    runs: [run(cards[3].ref, { status: 'failed' }), run('g/p#9', { status: 'gate' })],
    actions: [action('a', { state: 'pending' }), action('b', { state: 'failed' }), action('c', { state: 'done' })],
    alerts: [alert('w1')],
  };

  it('counts what is blocked (a blocker, or a run stopped on a failure), what asks, what waits in Actions and what needs the person', () => {
    const counts = homeCounts(input);
    expect(counts.blocked).toBe(2);
    expect(counts.asking).toBe(1);
    expect(counts.actions).toBe(2);
    expect(counts.needs).toBeGreaterThan(0);
  });

  it('is the count of the lists the Overview draws, not a second copy of the formulas', () => {
    const counts = homeCounts(input);
    expect(counts.blocked).toBe(blockedCards(cards, input.runs).length);
    expect(counts.asking).toBe(pendingQuestions(cards, input.turns, input.answered).length);
    expect(counts.needs).toBe(needsYou({ cards, turns: input.turns, answered: input.answered, actions: input.actions, alerts: input.alerts }).length + waitingRuns(input.runs ?? []).length);
  });

  it('is all zero for a quiet day and still has the four counts', () => {
    expect(homeCounts({ cards: [], turns: {}, answered: {}, runs: null, actions: [], alerts: [] })).toEqual({ blocked: 0, asking: 0, actions: 0, needs: 0 });
  });

  it('opens the Overview at the section a count names, and Actions for the third', () => {
    expect(stripTarget('blocked')).toEqual({ name: 'overview', section: 'blocked' });
    expect(stripTarget('asking')).toEqual({ name: 'overview', section: 'asking' });
    expect(stripTarget('needs')).toEqual({ name: 'overview', section: 'needs' });
    expect(stripTarget('actions')).toEqual({ name: 'actions' });
  });

  it('is read by the chat and the Overview from this module', () => {
    const chat = sources.find((s) => s.file.endsWith('screens/persona/ChatScreen.tsx'));
    const overview = sources.find((s) => s.file.endsWith('screens/Overview.tsx'));
    expect(chat?.text).toMatch(/homeCounts\(/);
    expect(overview?.text).toMatch(/blockedCards\(/);
    expect(overview?.text).toMatch(/pendingQuestions\(/);
  });
});

describe('ceremonyCard', () => {
  const base: AgoraInput = { hasCards: true, loadingCards: false, startedAt: null, callEnded: false, saved: false, resumed: false, ready: 2, total: 5, decisions: 0, effects: 0, retroDue: false };

  it('shows the Agora card when the pre-daily is ready, in progress or ended', () => {
    expect(ceremonyCard(agoraPlan(base), { preDaily: true })?.phase).toBe('ready');
    expect(ceremonyCard(agoraPlan({ ...base, startedAt: 1 }), { preDaily: true })?.phase).toBe('live');
    expect(ceremonyCard(agoraPlan({ ...base, startedAt: 1, callEnded: true }), { preDaily: true })?.phase).toBe('ended');
  });

  it('keeps the buttons of the plan, so starting from the card does what the Overview does', () => {
    const plan = agoraPlan({ ...base, retroDue: true });
    expect(ceremonyCard(plan, { preDaily: true })).toBe(plan);
    expect(plan.secondary.map((b) => b.action)).toContain('retro');
  });

  it('shows nothing for a cycle with no pre-daily, and nothing while the cards load', () => {
    expect(ceremonyCard(agoraPlan(base), { preDaily: false })).toBeNull();
    expect(ceremonyCard(agoraPlan({ ...base, hasCards: false }), { preDaily: true })).toBeNull();
  });

  it('shows the card while the cycle is still unknown', () => {
    expect(ceremonyCard(agoraPlan(base), undefined)?.phase).toBe('ready');
  });
});

describe('the menu', () => {
  const screens = (phone: boolean, on?: Parameters<typeof menuRows>[1]) => menuRows(phone, on).filter((r) => r.group === 'screens' && r.screen).map((r) => r.screen?.name);

  it('lists on the computer the buttons the Today header had, in its order, after the Overview', () => {
    expect(screens(false)).toEqual(['overview', 'history', 'runs', 'board', 'forum', 'procedures', 'memory', 'settings', 'custo', 'radar', 'saude', 'auditoria', 'help']);
  });

  it('lists on the phone the rows of the More sheet and Actions and History besides, since the chat has no bottom bar', () => {
    const phone = screens(true);
    for (const name of ['settings', 'runs', 'board', 'forum', 'procedures', 'memory', 'custo', 'radar', 'saude', 'auditoria', 'help', 'actions', 'history']) expect(phone).toContain(name);
    expect(phone[0]).toBe('overview');
    expect(new Set(phone).size).toBe(phone.length);
  });

  it('carries the four ceremonies on both, and leaves out the one the cycle turned off', () => {
    for (const phone of [false, true]) {
      expect(menuRows(phone).filter((r) => r.group === 'ceremonies').map((r) => r.id)).toEqual(['call', 'deep', 'qa', 'retro']);
      expect(menuRows(phone, { retro: false, qaHandoff: false }).filter((r) => r.group === 'ceremonies').map((r) => r.id)).toEqual(['call', 'deep']);
      expect(menuRows(phone, { preDaily: false }).some((r) => r.id === 'call')).toBe(false);
    }
  });

  it('leaves to the cards the two ceremonies that work on one', () => {
    const rows = menuRows(false);
    expect(rows.find((r) => r.id === 'deep')?.screen).toBeNull();
    expect(rows.find((r) => r.id === 'qa')?.screen).toBeNull();
    expect(rows.find((r) => r.id === 'call')?.screen).toEqual({ name: 'call' });
    expect(rows.find((r) => r.id === 'retro')?.screen).toEqual({ name: 'retro' });
  });
});

describe('Settings › Persona', () => {
  it('opens the chat screen and not a panel', () => {
    const section = sources.find((s) => s.file.endsWith('screens/persona/PersonaSection.tsx'));
    expect(section?.text).toMatch(/go\(\{ name: 'chat' \}\)/);
    expect(section?.text).not.toMatch(/ChatThread/);
  });
});

describe('Settings, in order', () => {
  it('draws the Persona section before the long team editor, where the chat\'s menu leads', () => {
    const text = sources.find((s) => s.file.endsWith('screens/Settings.tsx'))?.text ?? '';
    const at = (tag: string) => text.indexOf(tag);
    expect(at('<PersonaSection')).toBeGreaterThan(-1);
    expect(at('<PersonaSection')).toBeLessThan(at('<ConfigWorkspacesSection'));
    expect(at('<PersonaSection')).toBeLessThan(at('<TeamSettings'));
  });
});

describe('the page\'s save', () => {
  it('names the page, so it is not read as the persona\'s save that sits under it', () => {
    const text = sources.find((s) => s.file.endsWith('screens/Settings.tsx'))?.text ?? '';
    expect(text).toMatch(/\{t\('ui\.settings\.saveAll'\)\}/);
    expect(text).not.toMatch(/\{t\('ui\.settings\.save'\)\}/);
    setLanguage('en');
    expect(t('ui.settings.saveAll')).toBe('Save settings');
    setLanguage('pt-BR');
    expect(t('ui.settings.saveAll')).toBe('Salvar configurações');
    // The persona keeps its own, with its own words.
    expect(t('ui.persona.section.save')).not.toBe(t('ui.settings.saveAll'));
    setLanguage('en');
  });
});

describe('the strip on a phone', () => {
  it('words only the long count shorter there, in both languages and never as the same text', () => {
    expect(stripLabelKey('needs', false)).toBe('ui.chat.strip.needs');
    expect(stripLabelKey('needs', true)).toBe('ui.chat.strip.needsShort');
    for (const count of ['blocked', 'asking', 'actions'] as const) expect(stripLabelKey(count, true)).toBe(stripLabelKey(count, false));
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const short = t('ui.chat.strip.needsShort');
      expect(short).not.toBe('ui.chat.strip.needsShort');
      expect(short.length).toBeLessThan(t('ui.chat.strip.needs').length);
      // A quarter of 360 px at 12 px holds about 11 characters.
      for (const count of ['blocked', 'asking', 'actions', 'needs'] as const) expect(t(stripLabelKey(count, true)).length).toBeLessThanOrEqual(11);
    }
    setLanguage('en');
  });
});

describe('"Not now" on the wizard', () => {
  it('is kept for the session in a variable and never stored: the next opening starts without it', () => {
    expect(wizardSnoozed()).toBe(false);
    snoozeWizard();
    expect(wizardSnoozed()).toBe(true);
    resumeWizard();
    expect(wizardSnoozed()).toBe(false);
    const home = sources.find((s) => s.file === 'home.ts')?.text ?? '';
    expect(home).not.toMatch(/localStorage|sessionStorage|writeFile|api\./);
  });
});

describe('the app shell', () => {
  const app = sources.find((s) => s.file === 'App.tsx')?.text ?? '';

  it('opens on the home and lets homeView decide between the chat, the wizard and the Overview', () => {
    expect(app).toMatch(/useState<Screen>\(HOME\)/);
    expect(app).toMatch(/homeView\(/);
    expect(app).toMatch(/presentation="screen"/);
  });

  it('prepares every card\'s turn from the app, not from a screen, and counts an answer being written as work an update would cut', () => {
    expect(app).toMatch(/prepareAll/);
    expect(sources.find((s) => s.file.endsWith('screens/Overview.tsx'))?.text).not.toMatch(/prepareAll/);
    expect(app).toMatch(/useAnyLive\(\)/);
    expect(app).toMatch(/useReportUpdateBusy\([^)]*writing/);
  });
});
