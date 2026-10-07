import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '../src/shared/types';
import { gateOptions, gatePluginDocuments } from '../src/main/gate';

// The gate walks the cycle's own artifact list and, summed to it, the document types the plugins that are on add. Nothing of the
// reader of today's types changes: a plugin type appears where an ordinary artifact would, and disappears when it is not offered.

const card = (folder: string): Card => ({ ref: 'app#84', iid: '84', title: 'Plugin platform', stage: null, spec: { folder, phase: 'plan', planFile: null } } as Card);

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

  it('adds a plugin document to the options only when the file is present', () => {
    gatePluginDocuments.files = () => [['7_WEB_SEARCH.md', 'plugins.webSearch.document']];
    expect(gateOptions(card(dir)).map((o) => o.file)).toEqual([]);
    writeFileSync(join(dir, '7_WEB_SEARCH.md'), '# Web search\n');
    const options = gateOptions(card(dir));
    expect(options.map((o) => o.file)).toEqual([join(dir, '7_WEB_SEARCH.md')]);
    expect(options[0].gate).toBe(2);
  });

  it('is summed to the cycle artifacts, which keep their own place', () => {
    writeFileSync(join(dir, '2_PLAN.md'), '# Plan\n');
    gatePluginDocuments.files = () => [['7_WEB_SEARCH.md', 'plugins.webSearch.document']];
    writeFileSync(join(dir, '7_WEB_SEARCH.md'), '# Web search\n');
    // The test workspace has no cycle layout of its own; the plan file is not in it, so only the plugin document is offered here.
    expect(gateOptions(card(dir)).some((o) => o.file.endsWith('7_WEB_SEARCH.md'))).toBe(true);
  });

  it('offers nothing extra for a folder that is not there', () => {
    gatePluginDocuments.files = () => [['7_WEB_SEARCH.md', 'x']];
    expect(gateOptions(card(join(dir, 'gone')))).toEqual([]);
  });

  it('finds a plugin document in a subfolder the cycle layout names, as well as at the root', async () => {
    const config = await import('../src/main/workspaceConfig');
    const layout = config.rc().specLayout;
    const before = layout.gateFiles;
    layout.gateFiles = [{ sub: 'feature', gate: 1, files: [['1_SPEC.md', 'x']] }];
    try {
      gatePluginDocuments.files = () => [['7_WEB_SEARCH.md', 'x']];
      mkdirSync(join(dir, 'feature'), { recursive: true });
      writeFileSync(join(dir, 'feature', '7_WEB_SEARCH.md'), '# Web search\n');
      expect(gateOptions(card(dir)).map((o) => o.file)).toEqual([join(dir, 'feature', '7_WEB_SEARCH.md')]);
      writeFileSync(join(dir, '7_WEB_SEARCH.md'), '# Web search\n');
      expect(gateOptions(card(dir)).map((o) => o.file)).toEqual([join(dir, '7_WEB_SEARCH.md')]);
    } finally {
      layout.gateFiles = before;
    }
  });
});
