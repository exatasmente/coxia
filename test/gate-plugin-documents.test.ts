import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '../src/shared/types';
import type { PluginDocumentType } from '../src/shared/plugins/declaration';
import { gateOptions, gatePluginDocuments, pickGateOption } from '../src/main/gate';

// The gate walks the cycle's own artifact list and, summed to it, the document types the plugins that are on add. Nothing of the reader of today's types
// changes: a plugin type appears where an ordinary artifact would, at the gate its `flow` names (gate 2 when it says nothing, as before; no gate at all
// when it says there is none), and disappears when it is not offered.

const card = (folder: string): Card => ({ ref: 'app#84', iid: '84', title: 'Plugin platform', stage: null, spec: { folder, phase: 'plan', planFile: null } } as Card);
const doc = (name: string, over: Partial<PluginDocumentType> = {}): PluginDocumentType => ({ name, label: name, ...over });
const WEB = (): PluginDocumentType => ({ name: '7_WEB_SEARCH.md', label: 'plugins.webSearch.document' });
const REQUIREMENTS = (): PluginDocumentType => ({ name: 'REQUIREMENTS.md', label: 'cycle.agentFlow.gate.requirements', flow: { gate: 1, phase: { label: 'cycle.agentFlow.phase.requirements', before: '1_SPEC.md' } } });
const MANUAL = (): PluginDocumentType => ({ name: 'USER_MANUAL.md', label: 'cycle.agentFlow.gate.userManual', flow: { phase: { label: 'cycle.agentFlow.phase.userManual', before: '6_RELEASE_NOTE.md' } } });

describe('the gate documents of the plugins', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coxia-gate-plugins-'));
    gatePluginDocuments.files = () => [];
  });
  afterEach(() => {
    gatePluginDocuments.files = () => [];
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds a plugin document to the options only when the file is present, at gate 2 when the type says nothing about the flow', () => {
    gatePluginDocuments.files = () => [WEB()];
    expect(gateOptions(card(dir)).map((o) => o.file)).toEqual([]);
    writeFileSync(join(dir, '7_WEB_SEARCH.md'), '# Web search\n');
    const options = gateOptions(card(dir));
    expect(options.map((o) => o.file)).toEqual([join(dir, '7_WEB_SEARCH.md')]);
    expect(options[0].gate).toBe(2);
  });

  it('is summed to the cycle artifacts, which keep their own place', () => {
    writeFileSync(join(dir, '2_PLAN.md'), '# Plan\n');
    gatePluginDocuments.files = () => [WEB()];
    writeFileSync(join(dir, '7_WEB_SEARCH.md'), '# Web search\n');
    // The test workspace has no cycle layout of its own; the plan file is not in it, so only the plugin document is offered here.
    expect(gateOptions(card(dir)).some((o) => o.file.endsWith('7_WEB_SEARCH.md'))).toBe(true);
  });

  it('offers nothing extra for a folder that is not there', () => {
    gatePluginDocuments.files = () => [WEB()];
    expect(gateOptions(card(join(dir, 'gone')))).toEqual([]);
  });

  it('finds a plugin document in a subfolder the cycle layout names, as well as at the root', async () => {
    const config = await import('../src/main/workspaceConfig');
    const layout = config.rc().specLayout;
    const before = layout.gateFiles;
    layout.gateFiles = [{ sub: 'feature', gate: 1, files: [['1_SPEC.md', 'x']] }];
    try {
      gatePluginDocuments.files = () => [WEB()];
      mkdirSync(join(dir, 'feature'), { recursive: true });
      writeFileSync(join(dir, 'feature', '7_WEB_SEARCH.md'), '# Web search\n');
      expect(gateOptions(card(dir)).map((o) => o.file)).toEqual([join(dir, 'feature', '7_WEB_SEARCH.md')]);
      writeFileSync(join(dir, '7_WEB_SEARCH.md'), '# Web search\n');
      expect(gateOptions(card(dir)).map((o) => o.file)).toEqual([join(dir, '7_WEB_SEARCH.md')]);
    } finally {
      layout.gateFiles = before;
    }
  });

  it('offers a flow document at the gate it names: a folder with only the requirements still opens gate 1', async () => {
    const config = await import('../src/main/workspaceConfig');
    const layout = config.rc().specLayout;
    const before = layout.gateFiles;
    layout.gateFiles = [{ sub: '', gate: 1, files: [['1_SPEC.md', 'cycle.agentFlow.gate.spec']] }, { sub: '', gate: 2, files: [['2_PLAN.md', 'cycle.agentFlow.gate.plan']] }];
    try {
      gatePluginDocuments.files = () => [REQUIREMENTS()];
      writeFileSync(join(dir, 'REQUIREMENTS.md'), '# Requirements\n');
      expect(gateOptions(card(dir)).map((o) => [o.gate, o.file])).toEqual([[1, join(dir, 'REQUIREMENTS.md')]]);
      // With the spec beside it, both artifacts of gate 1 are there: the cycle's own first, as it is today.
      writeFileSync(join(dir, '1_SPEC.md'), '# Spec\n');
      expect(gateOptions(card(dir)).map((o) => [o.gate, o.file])).toEqual([
        [1, join(dir, '1_SPEC.md')],
        [1, join(dir, 'REQUIREMENTS.md')],
      ]);
    } finally {
      layout.gateFiles = before;
    }
  });

  it('never offers a document no gate reads: the user manual is not an artifact of any gate', () => {
    gatePluginDocuments.files = () => [MANUAL()];
    writeFileSync(join(dir, 'USER_MANUAL.md'), '# Manual\n');
    expect(gateOptions(card(dir))).toEqual([]);
  });
});

describe('the artifact a gate opens', () => {
  const options = [
    { gate: 1 as const, label: 'Spec', file: '/c/1_SPEC.md' },
    { gate: 1 as const, label: 'Requirements', file: '/c/REQUIREMENTS.md' },
    { gate: 2 as const, label: 'Plan', file: '/c/2_PLAN.md' },
  ];

  it('is the one the button named, among the options of that gate', () => {
    expect(pickGateOption(options, 1, '/c/REQUIREMENTS.md')?.file).toBe('/c/REQUIREMENTS.md');
    expect(pickGateOption(options, 1, '/c/1_SPEC.md')?.file).toBe('/c/1_SPEC.md');
    expect(pickGateOption(options, 2, '/c/2_PLAN.md')?.file).toBe('/c/2_PLAN.md');
  });

  it('falls back to the first option of the gate when the file is not one of the card: no path outside the card is ever opened by parameter', () => {
    expect(pickGateOption(options, 1, '/etc/passwd')?.file).toBe('/c/1_SPEC.md');
    expect(pickGateOption(options, 2, '/c/REQUIREMENTS.md')?.file).toBe('/c/2_PLAN.md');
    expect(pickGateOption(options, 2, '/c/USER_MANUAL.md')?.file).toBe('/c/2_PLAN.md');
  });

  it('is the first option of the gate when no file is named, as every call of today gets', () => {
    expect(pickGateOption(options, 1)?.file).toBe('/c/1_SPEC.md');
    expect(pickGateOption(options, 2)?.file).toBe('/c/2_PLAN.md');
  });

  it('is nothing when the gate has no artifact, and the caller reports it', () => {
    expect(pickGateOption([], 1)).toBeUndefined();
    expect(pickGateOption([{ gate: 2 as const, label: 'Plan', file: '/c/2_PLAN.md' }], 1)).toBeUndefined();
  });
});