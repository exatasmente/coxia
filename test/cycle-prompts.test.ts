import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { applyTemplate, builtInTemplate, familyOf, joinList, openersOf, promptFamilies, promptTemplate, refOpenersOf, renderLines, renderPrompt, userTerms, BASE_FAMILY } from '../src/shared/cycles';
import { CATALOGS } from '../src/shared/i18n';
import { calls, fakeVcs, installFakeEngine, runBasics, runScenario, type Captured, type Scenario } from './helpers/promptCapture';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));
vi.mock('../src/main/vcs', async (orig) => ({ ...(await orig<typeof import('../src/main/vcs')>()), vcsProvider: () => fakeVcs, vcsReady: () => true }));

const ROOT = join(import.meta.dirname, '..');
const cycleOf = (over: Partial<ReturnType<typeof neutralConfig>['devCycle']> = {}) => ({ ...neutralConfig().devCycle, ...over });

describe('how a prompt addresses the person', () => {
  it('uses the article of the name in Portuguese, with the contractions it needs', () => {
    expect(userTerms('pt-BR', { userName: 'Luiz', userArticle: 'o' })).toMatchObject({ theUser: 'o Luiz', TheUser: 'O Luiz', ofUser: 'do Luiz', toUser: 'ao Luiz', he: 'ele', his: 'dele', userName: 'Luiz' });
    expect(userTerms('pt-BR', { userName: 'Ana', userArticle: 'a' })).toMatchObject({ theUser: 'a Ana', ofUser: 'da Ana', toUser: 'à Ana', he: 'ela', his: 'dela' });
  });

  it('uses the bare name when no article is set, which is right for any name', () => {
    expect(userTerms('pt-BR', { userName: 'Sam', userArticle: '' })).toMatchObject({ theUser: 'Sam', ofUser: 'de Sam', toUser: 'a Sam', he: 'a pessoa', his: 'da pessoa' });
  });

  it('says "o usuário" when there is no name', () => {
    expect(userTerms('pt-BR', { userName: '  ', userArticle: 'o' })).toMatchObject({ theUser: 'o usuário', ofUser: 'do usuário', userName: '' });
    expect(userTerms('en', { userName: '', userArticle: '' })).toMatchObject({ theUser: 'the user', ofUser: "the user's", TheUser: 'The user' });
  });

  it('uses the possessive in English and ignores the article', () => {
    expect(userTerms('en', { userName: 'Ana', userArticle: 'a' })).toMatchObject({ theUser: 'Ana', ofUser: "Ana's", toUser: 'Ana', he: 'they', his: 'their' });
  });

  it('joins a list the way each language does', () => {
    expect(joinList(['a', 'b', 'c'], 'pt-BR')).toBe('a, b e c');
    expect(joinList(['a', 'b', 'c'], 'en')).toBe('a, b and c');
    expect(joinList(['a', '', 'b'], 'en')).toBe('a and b');
    expect(joinList(['a'], 'en')).toBe('a');
    expect(joinList([], 'pt-BR')).toBe('');
  });
});

describe('rendering a prompt', () => {
  it('fills the placeholders, leaves an unknown one visible and does not expand what a value contains', () => {
    expect(renderLines('Hi {name}, {other} {nested}', { name: 'Ana', nested: '{name}' })).toBe('Hi Ana, {other} {name}');
  });

  it('drops a line that is only a placeholder with an empty value: that is how an optional sentence is left out', () => {
    expect(renderLines('a\n{hint}\nb', { hint: '' })).toBe('a\nb');
    expect(renderLines('a\n{hint}\nb', { hint: 'x' })).toBe('a\nx\nb');
    expect(renderLines('a\n- {hint}\nb', { hint: '' })).toBe('a\n- \nb');
  });

  it('keeps the empty line when the caller says so', () => {
    expect(renderLines('{intro}\nb', { intro: '' }, { keepEmpty: ['intro'] })).toBe('\nb');
  });

  it('reads the text of the role family, falls back to the base family, and lets the cycle override a single text', () => {
    const base = cycleOf();
    expect(promptTemplate(base, 'retro.main', 'pt-BR')).toContain('Retro semanal');
    expect(promptTemplate({ ...base, prompts: { ...base.prompts, retro: 'scrum' } }, 'retro.main', 'pt-BR')).toContain('Retrospectiva da sprint');
    expect(promptTemplate({ ...base, prompts: { ...base.prompts, retro: 'scrum' } }, 'retro.main', 'en')).toContain('sprint retrospective');
    // The scrum family has no text for the turn: the base one is used.
    expect(promptTemplate({ ...base, prompts: { ...base.prompts, turn: 'scrum' } }, 'turn.main', 'en')).toBe(promptTemplate(base, 'turn.main', 'en'));
    const overridden = { ...base, promptOverrides: { 'turn.specHint': { 'pt-BR': 'Leia a pasta {reads} vezes.' } } };
    expect(renderPrompt(overridden, 'turn.specHint', 'pt-BR', { reads: 2 })).toBe('Leia a pasta 2 vezes.');
    // An override for one language leaves the other alone.
    expect(renderPrompt(overridden, 'turn.specHint', 'en', { reads: 2 })).toContain('at most 2 reads');
  });

  it('allows an override that blanks a text out', () => {
    const blank = { ...cycleOf(), promptOverrides: { 'qa.skillsLine': { 'pt-BR': '' } } };
    expect(renderPrompt(blank, 'qa.skillsLine', 'pt-BR')).toBe('');
  });

  it('refuses an id nobody wrote, so a typo is not a silently empty prompt', () => {
    expect(() => renderPrompt(cycleOf(), 'turn.nothing', 'en')).toThrow(/turn\.nothing/);
  });

  it('picks the family by the role the prompt id belongs to', () => {
    const c = cycleOf({ prompts: { ...cycleOf().prompts, qa: 'x', retro: 'y' } });
    expect(familyOf(c, 'reentry.main')).toBe('x');
    expect(familyOf(c, 'discussion.main')).toBe('x');
    expect(familyOf(c, 'retro.ask')).toBe('y');
    expect(familyOf(c, 'rules.speech')).toBe(BASE_FAMILY);
  });
});

describe('the prompt catalogs', () => {
  const fam = promptFamilies('pt-BR');

  it('define the base family completely, in both languages', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const ids = Object.keys(CATALOGS[language]).filter((k) => k.startsWith('prompt.sdd.'));
      expect(ids.length, language).toBe(fam[BASE_FAMILY].length);
    }
  });

  it('only let another family replace a text the base family has', () => {
    for (const [family, ids] of Object.entries(fam)) {
      if (family === BASE_FAMILY) continue;
      for (const id of ids) expect(CATALOGS['pt-BR'][`prompt.sdd.${id}`], `${family}.${id}`).toBeTruthy();
    }
  });

  it('cover every prompt the code asks for', () => {
    const asked = new Set<string>();
    const dir = join(ROOT, 'src/main');
    for (const file of readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/\b(?:cp|prompt)\(\s*'([a-z][\w.]*)'/g)) asked.add(m[1]);
    }
    expect(asked.size).toBeGreaterThan(60);
    for (const id of asked) {
      expect(CATALOGS['pt-BR'][`prompt.sdd.${id}`], `pt-BR ${id}`).not.toBeUndefined();
      expect(CATALOGS.en[`prompt.sdd.${id}`], `en ${id}`).not.toBeUndefined();
    }
  });

  it('leave no prompt of the base family unused', () => {
    const used = new Set<string>();
    const dir = join(ROOT, 'src/main');
    for (const file of readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/\b(?:cp|prompt)\(\s*'([a-z][\w.]*)'/g)) used.add(m[1]);
    }
    // Ids rendered by the rules of baseParams (cyclePrompts.ts) rather than named at a call.
    const direct = new Set(['rules.speech', 'rules.speechExamples', 'rules.chat', 'options.rule']);
    // The effect check kinds are read by a computed id (efeitos.ts: `effects.kind.${kind}`).
    const computed = /^effects\.kind\./;
    // A ".novoice" text is the same prompt worded for a conversation without voice: it is read through its base id.
    const unused = fam[BASE_FAMILY].filter((id) => !id.endsWith('.novoice') && !used.has(id) && !direct.has(id) && !computed.test(id));
    for (const id of fam[BASE_FAMILY].filter((x) => x.endsWith('.novoice'))) expect(fam[BASE_FAMILY], id).toContain(id.replace(/\.novoice$/, ''));
    expect(unused).toEqual([]);
  });

  it('say the same thing in English as in Portuguese: no prompt copied untranslated', () => {
    const same = fam[BASE_FAMILY].filter((id) => CATALOGS['pt-BR'][`prompt.sdd.${id}`] === CATALOGS.en[`prompt.sdd.${id}`] && CATALOGS['pt-BR'][`prompt.sdd.${id}`].length > 12);
    // The few texts that are the same in both languages are code (a table row, a heading template), not prose.
    expect([...same].sort()).toEqual(['discussion.note', 'gate.doc.heading', 'gate.doc.other', 'gate.doc.title', 'qa.doc.title', 'reentry.note']);
  });
});

describe('recognising a prompt by how it begins', () => {
  it('matches the openings of the prompts, in both languages and every family, whoever the user is', () => {
    expect(openersOf('turn.main').some((re) => re.test('Você é o agente da atividade sz4#1 na pré-daily por voz.'))).toBe(true);
    expect(openersOf('turn.main').some((re) => re.test('You are the agent of activity api#7 in the voice daily scrum.'))).toBe(true);
    expect(openersOf('retro.main').some((re) => re.test('Retro semanal da Ana, por voz, de 01/10/2026 a 08/10/2026. Você conduz.'))).toBe(true);
    expect(openersOf('retro.main').some((re) => re.test("Sprint retrospective of Ana, by voice"))).toBe(false);
    expect(openersOf('retro.main').some((re) => re.test("Ana's sprint retrospective, by voice, from 10/1/2026 to 10/8/2026."))).toBe(true);
  });

  it('does not match what the person writes in their own session', () => {
    for (const id of ['turn.main', 'deep.intro', 'gate.start', 'qa.prepare', 'retro.main', 'teams.main']) {
      expect(openersOf(id).some((re) => re.test('Explique o que este arquivo faz')), id).toBe(false);
      expect(openersOf(id).some((re) => re.test('Review this change and write the tests')), id).toBe(false);
    }
  });

  it('captures the ref of the card from the first line', () => {
    const find = (id: string, text: string) => refOpenersOf(id).map((re) => re.exec(text)?.[1]).find(Boolean);
    expect(find('turn.main', 'Você é o agente da atividade sz4#15499 na pré-daily por voz.')).toBe('sz4#15499');
    expect(find('deep.intro', 'Unblock of activity 42, by voice. Investigate by reading spec')).toBe('42');
    expect(find('gate.start', 'Gate 2 da issue sz4#1 (Título), por voz.')).toBe('sz4#1');
    expect(find('retro.main', 'Retro semanal do Luiz, por voz')).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
// The same ceremonies for someone who is not the author: another language, another name, a cycle that is only the generic SDD template.

function configure(patch: (c: ReturnType<typeof neutralConfig>) => void, templateId = 'sdd') {
  return async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    const c = applyTemplate(neutralConfig(), builtInTemplate(templateId)!);
    // A fresh install has voice off until the wizard sets it up; the wording of a spoken ceremony is what these tests look at.
    c.voice.enabled = true;
    // What the machine happens to have in ~/.claude must not change what the agents are told.
    c.docs.autoDetect = false;
    patch(c);
    saveConfig(c);
  };
}

const LEFTOVER = /\{[A-Za-z]+\}/;
const all = (s: Scenario) => Object.values(s.prompts).filter((p) => p.role !== 'store');

describe('English, a person named Ana, the generic SDD template', () => {
  let scenario: Scenario;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00'));
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    await configure((c) => {
      c.language = 'en';
      c.userName = 'Ana';
    })();
    await installFakeEngine();
    scenario = await runScenario(process.env.CERIMONIAS_SPECS_DIR as string, { registro: 'Decision log' });
  });

  it('writes every prompt in English, to Ana, with no placeholder left and nothing of the author', () => {
    for (const [name, p] of Object.entries(scenario.prompts)) {
      if (p.role === 'store') continue;
      expect(p.prompt, name).not.toMatch(LEFTOVER);
      expect(p.system, name).not.toMatch(LEFTOVER);
      expect(p.prompt, name).not.toMatch(/Luiz|Português|\bvocê\b|playbook|agent-pipeline|qa\.interno|hub-whatsapp|post-release-sync|daily-report \w+ \w+/i);
    }
    const text = all(scenario).map((p) => p.prompt).join('\n');
    expect(text).toContain('Ana');
    expect(text).toContain('Spoken English');
  });

  it('introduces the agent in English, with the name', () => {
    expect(scenario.prompts.turn.system).toContain("voice ceremony of Ana's");
    expect(scenario.prompts.turn.system).toContain('for Ana to run later');
    expect(scenario.prompts.turn.prompt).toMatch(/^You are the agent of activity sz4#15499 in the pre-daily, by voice\./);
    expect(scenario.prompts.reply.prompt).toContain('Ana answered by voice (the transcript may have errors)');
    expect(scenario.prompts.deep.prompt).toContain("Ana's question (voice transcript)");
  });

  it('says what only the generic template knows: no company, no tool, a neutral summary target', () => {
    expect(scenario.prompts.teams.prompt).toContain('paste into the team chat');
    expect(scenario.prompts.deep.prompt).toMatch(/Investigate by reading spec/);
    expect(scenario.prompts['gate-start'].prompt).toContain('Quiz rules: up to 3 CONSEQUENCE questions (prediction, counterfactual, boundary, side effect, rollback, regression)');
    expect(scenario.prompts['qa-prepare'].prompt).toContain('looking for the note "the QA user"');
    expect(scenario.prompts.reentry.prompt).toContain('There is no note from the QA user');
    expect(scenario.prompts.turn.prompt).toContain('In this team: A blocker is anything');
  });

  it('writes the spec files in English too, into the section the template names', () => {
    expect(scenario.files['bug/GATE_QUIZ.md']).toContain('**Verdict:** in progress — 2 round(s) so far · run by voice in the ceremonies app');
    expect(scenario.files['bug/GATE_QUIZ.md']).toContain('### Round 1');
    expect(scenario.files['bug/GATE_QUIZ.md']).toContain('| # | Question (kind) | Options | Chosen | Correct? |');
    expect(scenario.files['bug/GATE_QUIZ.md']).not.toContain('agent-pipeline');
    expect(scenario.files['QA_CHECKLIST.md']).toContain('> **Environment:**');
    expect(scenario.files['plan-after-registro']).toContain('- 2026-10-02 (pre-daily, by voice): Seguir com o merge hoje');
  });

  it('asks the model for the question kinds in English', () => {
    expect(scenario.prompts['gate-start'].schemaKeys).toEqual(['resumo', 'perguntas']);
  });
});

describe('Portuguese, a person named Ana (feminine), the generic SDD template', () => {
  let scenario: Scenario;

  beforeAll(async () => {
    calls.length = 0;
    await configure((c) => {
      c.language = 'pt-BR';
      c.userName = 'Ana';
      c.userArticle = 'a';
    })();
    scenario = await runScenario(process.env.CERIMONIAS_SPECS_DIR as string, { registro: 'Registro de decisões' });
  });

  it('uses her article, her contractions and her pronoun', () => {
    expect(scenario.prompts.turn.system).toContain('cerimônia por voz da Ana');
    expect(scenario.prompts.turn.system).toContain('para a Ana executar depois');
    expect(scenario.prompts.reply.prompt).toContain('A Ana respondeu por voz');
    expect(scenario.prompts.reply.prompt).toContain('true se ela pediu para aprofundar');
    expect(scenario.prompts['gate-explain'].prompt).toContain('respondendo o que ela perguntar');
    expect(scenario.prompts.reentry.prompt).toContain('Você explica à Ana');
    expect(scenario.prompts.discussion.prompt).toContain('rascunho da resposta dela');
    expect(all(scenario).map((p) => p.prompt).join('\n')).not.toMatch(/Luiz/);
  });

  it('has no placeholder left, and writes into the section the template names', () => {
    for (const [name, p] of Object.entries(scenario.prompts)) if (p.role !== 'store') expect(p.prompt, name).not.toMatch(LEFTOVER);
    expect(scenario.files['plan-after-registro']).toContain('- 2026-10-02 (pré-daily por voz): Seguir com o merge hoje');
  });
});

describe('the Scrum template', () => {
  let basics: Record<string, Captured>;

  beforeAll(async () => {
    await configure((c) => {
      c.language = 'en';
      c.userName = 'Sam';
    }, 'scrum')();
    calls.length = 0;
    basics = await runBasics('app#9');
  });

  it('calls the preparation a daily scrum and says nothing of specs, gates or QA', () => {
    expect(basics.turn.prompt).toContain('in the daily scrum, by voice');
    expect(basics.turn.prompt).not.toMatch(/\b(spec|gate|gates)\b/i);
    expect(basics.turn.prompt).toContain('In this team: An impediment');
    expect(basics.turn.prompt).toContain('Spoken English');
  });

  it('does not offer the plan as a place for decisions or a card note it does not have', () => {
    expect(basics.reply.prompt).toContain('"alvo" (target): "ata" (minutes) for everything else.');
    expect(basics.reply.prompt).not.toContain('"spec" if');
    expect(basics.reply.prompt).not.toContain('"daily-report" if');
    expect(basics['deep-options'].prompt).toContain('a ready sentence for the minutes');
  });

  it('investigates the project, not specs and rules, and writes the summary for the team chat in the scrum style', () => {
    expect(basics.deep.prompt).toContain('Investigate by reading the project code');
    expect(basics.teams.prompt).toContain('paste into the team chat');
    expect(basics.teams.prompt).toContain('Daily scrum style');
    expect(basics.teams.prompt).toContain('"Impediments:"');
  });

  it('runs a sprint retrospective of fourteen days', () => {
    expect(basics.retro.prompt).toMatch(/^Sam's sprint retrospective, by voice, from 9\/18\/2026 to 10\/2\/2026\./);
    expect(basics.retro.prompt).toContain('was the sprint goal met?');
    expect(basics.retro.prompt).toContain('Sprint summary:');
    expect(basics.retro.prompt).not.toMatch(LEFTOVER);
  });

  it('gives the card context without a spec line', () => {
    expect(basics.turn.prompt).toContain('Activity card:');
    expect(basics.turn.prompt).not.toContain('Spec in');
    expect(basics.turn.prompt).not.toContain('No spec folder');
  });
});

describe('a conversation without voice', () => {
  it('speaks of text, not of voice, in either language, with the same cycle', async () => {
    const quiet = (language: 'pt-BR' | 'en') =>
      configure((c) => {
        c.language = language;
        c.userName = 'Sam';
        c.voice.enabled = false;
      });
    await quiet('pt-BR')();
    calls.length = 0;
    const pt = await runBasics('quiet#1');
    expect(pt.turn.prompt).toMatch(/^Você é o agente da atividade quiet#1 na pré-daily em texto\./);
    expect(pt.turn.prompt).toContain('A voz está desligada');
    expect(pt.turn.system).toContain('conduzida por texto (a voz está desligada)');
    expect(pt.reply.prompt).toContain('respondeu por escrito: «go ahead»');
    expect(pt.deep.prompt).toContain('(texto digitado)');
    expect(pt.deep.prompt).not.toMatch(/para ser ouvid|falado|transcrição/);
    await quiet('en')();
    const en = await runBasics('quiet#2');
    expect(en.turn.prompt).toMatch(/^You are the agent of activity quiet#2 in the pre-daily, in text\./);
    expect(en.turn.prompt).toContain('Voice is off');
    expect(en.reply.prompt).toContain('Sam answered in writing: «go ahead»');
    expect(en.deep.prompt).toContain('(typed text)');
    expect(en.deep.prompt).not.toMatch(/to be heard|Spoken English|voice transcript/);
    for (const p of [...Object.values(pt), ...Object.values(en)]) expect(p.prompt).not.toMatch(LEFTOVER);
  });
});
