// The declarations that ship with the app: a document-only plugin read from the app's own folder, on by default, with the saved choice of the person
// winning in both directions and a copy of the same identity in the workspace folder winning over the app folder. Nothing here touches a real workspace:
// throwaway folders on both sides.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { neutralPlugins } from '../src/shared/config/defaults';
import type { PluginsConfig } from '../src/shared/config/types';
import { readPluginDeclaration } from '../src/shared/plugins/declaration';
import { readPlugins } from '../src/main/plugins/read';
import type { PluginsDeps } from '../src/main/plugins/module';

const { enabledDocuments, pluginsDeps } = await import('../src/main/plugins/module');

const root = mkdtempSync(join(tmpdir(), 'coxia-plugin-builtin-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** One workspace folder and one app folder per test, so a plugin written for one never leaks into the next. */
function spaces(name: string): { ws: string; built: string } {
  const dir = join(root, name);
  const ws = join(dir, 'ws');
  const built = join(dir, 'app');
  mkdirSync(ws, { recursive: true });
  mkdirSync(built, { recursive: true });
  return { ws, built };
}

/** Writes one plugin folder under `dir`; `offers` is what its declaration says it offers. */
function writePlugin(dir: string, id: string, offers: Record<string, unknown>, name = 'Documents'): void {
  const folder = join(dir, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'plugin.json'), JSON.stringify({ id, name, contract: 1, offers }));
}

const documents = [
  { name: 'REQUIREMENTS.md', label: 'Requirements', flow: { gate: 1, phase: { before: '1_SPEC.md' } } },
  { name: 'PROTOTYPE.md', label: 'Prototype', flow: { gate: 2, phase: { before: '2_PLAN.md' } } },
  { name: 'USER_MANUAL.md', label: 'User manual', flow: { phase: { before: '6_RELEASE_NOTE.md' } } },
];
const choice = (enabled: boolean): PluginsConfig['list'] => [{ id: 'docs', folder: null, enabled, allow: { network: false, write: false }, settings: {} }];
const configOf = (list: PluginsConfig['list']): PluginsConfig => ({ ...neutralPlugins(), dir: '', list });

describe('a declaration that comes with the app', () => {
  it('is read on by default: a folder that names documents and nothing else needs no switch to be on', () => {
    const { ws, built } = spaces('default-on');
    writePlugin(built, 'docs', { documents });
    const list = readPlugins(ws, neutralPlugins(), built);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'docs', enabled: true, documents });
  });

  it('keeps what the person saved about it in both directions', () => {
    const { ws, built } = spaces('saved-choice');
    writePlugin(built, 'docs', { documents });
    expect(readPlugins(ws, configOf(choice(false)), built)[0]?.enabled).toBe(false);
    expect(readPlugins(ws, configOf(choice(true)), built)[0]?.enabled).toBe(true);
  });

  it('is set aside when the workspace folder holds a copy of the same identity: the copy of the person wins', () => {
    const { ws, built } = spaces('copy-wins');
    writePlugin(built, 'docs', { documents });
    writePlugin(ws, 'docs', { documents }, 'My copy');
    const list = readPlugins(ws, neutralPlugins(), built);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'My copy', enabled: false });
  });

  it('is never what has code or something to reach: a plugin dropped in with a script, a note, a host or a write is not treated as built in', () => {
    const { ws, built } = spaces('capability');
    writePlugin(built, 'scripted', { documents, entry: 'run.sh' });
    writePlugin(built, 'noisy', { documents, agents: 'Ask me about anything.' });
    writePlugin(built, 'reaching', { documents, network: ['search.example.com'] });
    writePlugin(built, 'writing', { documents, write: { to: 'results', reversible: true } });
    expect(readPlugins(ws, neutralPlugins(), built)).toEqual([]);
  });

  it('brings nothing and breaks nothing when the app folder is not there', () => {
    const { ws, built } = spaces('gone');
    writePlugin(ws, 'mine', { documents }, 'Mine');
    expect(readPlugins(ws, neutralPlugins(), join(root, 'gone'))).toHaveLength(1);
    expect(readPlugins(built, neutralPlugins(), join(root, 'gone'))).toEqual([]);
  });

  it('is read again at every call: an off plugin offers no document and an on one offers its own', () => {
    const { ws, built } = spaces('every-call');
    writePlugin(built, 'docs', { documents });
    let config = configOf([]);
    const deps = { dir: () => ws, config: () => config, read: (dir: string, c: PluginsConfig) => readPlugins(dir, c, built) } as PluginsDeps;
    expect(enabledDocuments(deps).map((d) => d.name)).toEqual(['REQUIREMENTS.md', 'PROTOTYPE.md', 'USER_MANUAL.md']);
    config = configOf(choice(false));
    expect(enabledDocuments(deps)).toEqual([]);
    config = configOf(choice(true));
    expect(enabledDocuments(deps).map((d) => d.name)).toEqual(['REQUIREMENTS.md', 'PROTOTYPE.md', 'USER_MANUAL.md']);
  });
});

describe('the document types the app ships', () => {
  it('are the three the flow writes, each at its gate and its anchor', () => {
    const folder = join(import.meta.dirname, '..', 'plugins', 'cycle-artifacts');
    const reading = readPluginDeclaration(readFileSync(join(folder, 'plugin.json'), 'utf8'), folder);
    expect(reading.refused).toBeNull();
    expect(reading.declaration?.offers.documents).toEqual([
      { name: 'REQUIREMENTS.md', label: 'cycle.agentFlow.gate.requirements', flow: { gate: 1, phase: { label: 'cycle.agentFlow.phase.requirements', before: '1_SPEC.md' } } },
      { name: 'PROTOTYPE.md', label: 'cycle.agentFlow.gate.prototype', flow: { gate: 2, phase: { label: 'cycle.agentFlow.phase.prototype', before: '2_PLAN.md' } } },
      { name: 'USER_MANUAL.md', label: 'cycle.agentFlow.gate.userManual', flow: { phase: { label: 'cycle.agentFlow.phase.userManual', before: '6_RELEASE_NOTE.md' } } },
    ]);
    expect(reading.declaration?.offers.entry).toBeNull();
    expect(reading.declaration?.offers.events).toEqual([]);
    expect(reading.declaration?.offers.agents).toBeNull();
  });

  it('come into the read of every workspace through the folder of the app itself', () => {
    const { ws } = spaces('wired');
    const ids = pluginsDeps.read(ws, neutralPlugins()).map((r) => r.id);
    expect(ids).toContain('cycle-artifacts');
    expect(pluginsDeps.read(ws, neutralPlugins()).find((r) => r.id === 'cycle-artifacts')?.enabled).toBe(true);
  });
});