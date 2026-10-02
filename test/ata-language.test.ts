import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { applyTemplate, builtInTemplate } from '../src/shared/cycles';
import type { Minutes } from '../src/shared/types';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));

// The minutes ("ata") are a file the app writes for people: the headings and the fixed words follow the language of the workspace.
const minutes = (full: boolean): Minutes => ({
  startedAt: '2026-10-02T09:40:00Z',
  endedAt: '2026-10-02T09:55:00Z',
  decisions: full ? [{ ref: 'app#7', text: 'ship it today', target: 'ata', dest: 'the minutes' }] : [],
  effects: full ? [{ ref: 'app#7', text: 'open the MR', repo: 'app' }] : [],
  unanswered: full ? [{ ref: 'app#7', question: 'Can it go?' }] : [],
  transcript: [{ who: 'Ana', text: 'good morning', at: '09:40' }],
});

async function save(language: 'pt-BR' | 'en', full: boolean): Promise<string> {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = applyTemplate(neutralConfig(), builtInTemplate('sdd')!);
  c.language = language;
  c.userName = 'Ana';
  saveConfig(c);
  const { saveMinutes } = await import('../src/main/store');
  const result = await saveMinutes(minutes(full), 'team text', full ? [0] : []);
  const text = readFileSync(result.ataPath, 'utf8');
  // The minutes of a day pile up in one file: each save starts from an empty one.
  writeFileSync(result.ataPath, '');
  return text;
}

describe('the minutes file', () => {
  let pt: string;
  let en: string;

  beforeAll(async () => {
    pt = await save('pt-BR', true);
    en = await save('en', true);
  });

  it('keeps the Portuguese headings as they always were', () => {
    expect(pt).toMatch(/## Pré-daily \d{2}:\d{2}:\d{2} às \d{2}:\d{2}:\d{2}/);
    for (const heading of ['### Decisões', '### Efeitos aguardando "sim" no Claude Code', '### Perguntas sem resposta', '### Texto para a daily do time', '### Transcrição']) expect(pt).toContain(heading);
    expect(pt).toContain('- app#7: ship it today → the minutes');
  });

  it('writes the English headings and no Portuguese word of its own', () => {
    expect(en).toMatch(/## Pre-daily \d{1,2}:\d{2}:\d{2} [AP]M to \d{1,2}:\d{2}:\d{2} [AP]M/);
    for (const heading of ['### Decisions', '### Effects waiting for a "yes" in Claude Code', '### Unanswered questions', '### Text for the team daily', '### Transcript']) expect(en).toContain(heading);
    expect(en).toContain('- app#7 (app): open the MR');
    expect(en).toContain('- 09:40 **Ana**: good morning');
    expect(en).not.toMatch(/Decisões|Efeitos|Perguntas|Transcrição| às /);
  });

  it('says "none" in the language of the file when a list is empty', async () => {
    const emptyPt = await save('pt-BR', false);
    const emptyEn = await save('en', false);
    expect(emptyPt).toContain('- nenhuma');
    expect(emptyPt).toContain('- nenhum\n');
    expect(emptyEn).toContain('- none');
    expect(emptyEn).not.toMatch(/nenhum/);
  });
});
