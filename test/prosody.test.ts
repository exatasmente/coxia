import { describe, expect, it } from 'vitest';
import { edgePitch, edgeRate, kokoroSpeed, needsJoin, prosodyPlan, sentences, speakable } from '../src/main/prosody';

describe('speakable', () => {
  it('replaces diagrams and code with a pointer to the screen', () => {
    const text = 'Veja:\n```mermaid\ngraph TD; A-->B\n```\nE o código:\n```php\n$a = 1;\n```';
    const out = speakable(text);
    expect(out).toContain('O diagrama está na tela.');
    expect(out).toContain('O trecho de código está na tela.');
    expect(out).not.toMatch(/graph TD|\$a = 1/);
  });

  it('drops markdown marks, links and urls', () => {
    expect(speakable('## Status\n**Aprovado** no [MR 9302](https://x/y) e `main`, veja https://gitlab/z')).toBe(
      'Status\nAprovado no MR 9302 e main, veja o link na tela',
    );
  });
});

describe('sentences', () => {
  it('splits on sentence ends but not on abbreviations or decimals', () => {
    expect(sentences('O Sr. Silva aprovou a versão 49.0.2 hoje. Falta o QA? Sim!')).toEqual([
      'O Sr. Silva aprovou a versão 49.0.2 hoje.',
      'Falta o QA?',
      'Sim!',
    ]);
  });

  it('keeps a colon inside the sentence', () => {
    expect(sentences('Passo 1: rodar o teste. Depois commitar.')).toEqual(['Passo 1: rodar o teste.', 'Depois commitar.']);
  });
});

describe('prosodyPlan', () => {
  it('gives each sentence its tone and pause', () => {
    const plan = prosodyPlan('O 9302 está aprovado. O bloqueio é o conflito no 797. Posso seguir com o merge?');
    expect(plan.map((s) => s.tone)).toEqual(['positive', 'alert', 'question']);
    expect(plan[1].rate).toBeLessThan(0);
    expect(plan[2].pitch).toBeGreaterThan(0);
    expect(plan[0].pauseMs).toBe(300);
    expect(plan[1].pauseMs).toBe(300);
    expect(plan[2].pauseMs).toBe(0);
  });

  it('does not take a negated alert word as an alert', () => {
    expect(prosodyPlan('Está pronto e sem bloqueio.')[0].tone).toBe('positive');
    expect(prosodyPlan('Não há risco nenhum aqui.')[0].tone).toBe('neutral');
  });

  it('pauses longer between paragraphs and after list items', () => {
    const plan = prosodyPlan('Pendências:\n- rodar o teste\n- revisar o MR\n\nDepois disso, fecho a issue.');
    expect(plan.map((s) => s.text)).toEqual(['Pendências:', 'rodar o teste', 'revisar o MR', 'Depois disso, fecho a issue.']);
    expect(plan[0].pauseMs).toBe(250);
    expect(plan[1].pauseMs).toBe(320);
    expect(plan[2].pauseMs).toBe(600);
  });

  it('slows the closing sentence of a longer speech, but not a closing question', () => {
    expect(prosodyPlan('Um. Dois. Três.').at(-1)?.rate).toBe(-4);
    expect(prosodyPlan('Um. Dois. Três?').at(-1)?.rate).toBe(-2);
  });

  it('reads a parenthetical faster and lower', () => {
    expect(prosodyPlan('Fiz o deploy. (Era o que faltava.)').at(-1)?.tone).toBe('aside');
  });

  it('caps the number of segments', () => {
    const plan = prosodyPlan(Array.from({ length: 60 }, (_, i) => `Frase ${i}.`).join(' '));
    expect(plan).toHaveLength(40);
    expect(plan.at(-1)?.text).toContain('Frase 59.');
  });

  it('returns nothing for empty text', () => {
    expect(prosodyPlan('  \n ')).toEqual([]);
  });
});

describe('voice parameters', () => {
  it('adds the deltas to the voice base and clamps them', () => {
    expect(edgeRate('+5%', -7)).toBe('-2%');
    expect(edgeRate('+90%', 30)).toBe('+100%');
    expect(edgePitch('-8Hz', 5)).toBe('-3Hz');
    expect(edgePitch('+0Hz', 0)).toBe('+0Hz');
    expect(kokoroSpeed(1.05, -7)).toBeCloseTo(0.977, 2);
    expect(kokoroSpeed(1.9, 20)).toBe(2);
  });

  it('keeps the plain request for a single neutral sentence', () => {
    expect(needsJoin(prosodyPlan('Bom dia.'))).toBe(false);
    expect(needsJoin(prosodyPlan('Tudo certo?'))).toBe(true);
    expect(needsJoin(prosodyPlan('Bom dia. Vamos lá.'))).toBe(true);
  });
});
