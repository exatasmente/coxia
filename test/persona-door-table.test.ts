// The pinned table of the persona's door (#248): every channel the app registers is either one operation of one of the eleven tools or on the exclusion list with its reason, and a
// channel added with neither fails here, the way an unlisted `persona:` channel is denied to the phone. The registered set is read from the sources: the literal names, the four
// constant forms, and a failure for a registration of a form this test does not know, so a new way of registering cannot hide a channel.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_GET } from '../src/shared/activity';
import { PERSONA_LIVE_READ } from '../src/shared/persona';
import { PERSONA_STOP_CHANNELS } from '../src/shared/personaStop';
import { VOICE_CHANNELS } from '../src/shared/voiceSetup';
import { WIZARD_CHANNELS } from '../src/shared/wizard';
import { EXCLUDED, EXCLUSION_REASONS, OPS, TOOL_NAMES, DOOR_ONLY, keyOf, opsOf } from '../src/main/persona/doorTable';

const SRC = join(import.meta.dirname, '../src/main');
const files = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f));

// Calls of `handle(` that are not registrations of a channel: a parser's own helper in each of these three files.
const NOT_REGISTRATIONS = new Set(['rpc.ts', 'sandbox/proxy.ts', 'browser/mcpClient.ts']);
const CONSTANTS = new Set(['ACTIVITY_GET', 'PERSONA_LIVE_READ']);

function registered(): { channels: Set<string>; unknown: string[] } {
  const channels = new Set<string>();
  const unknown: string[] = [];
  const named = [...Object.values(VOICE_CHANNELS), ...Object.values(WIZARD_CHANNELS), ACTIVITY_GET, PERSONA_LIVE_READ];
  let viaConstant = 0;
  for (const file of files(SRC)) {
    const rel = file.slice(SRC.length + 1);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bhandle(?:Device)?\(\s*([^,)\n]*)/g)) {
      const first = m[1].trim();
      const literal = /^(['"`])([^'"`]+)\1$/.exec(first);
      if (literal) {
        channels.add(literal[2]);
        continue;
      }
      if (NOT_REGISTRATIONS.has(rel) || /^(channel|head\.|line)/.test(first) || /^[\w.]+:\s/.test(first) || first === '') continue;
      // A parameter of a type, the declaration of a function that takes a channel, or a constant the test knows.
      if (/^(VOICE_CHANNELS\.\w+|C\.\w+|ACTIVITY_GET|PERSONA_LIVE_READ)$/.test(first) || CONSTANTS.has(first)) {
        viaConstant += 1;
        continue;
      }
      unknown.push(`${rel}: handle(${first}`);
    }
  }
  for (const channel of named) channels.add(channel);
  expect(viaConstant).toBeGreaterThan(20);
  return { channels, unknown };
}

describe('the table of the persona door', () => {
  const { channels, unknown } = registered();
  const named = OPS.filter((o) => o.channel !== null).map((o) => o.channel as string);

  it('finds every registration: 336 channels, and no form of registration it does not know', () => {
    expect(unknown).toEqual([]);
    expect(channels.size).toBe(336);
    for (const channel of PERSONA_STOP_CHANNELS) expect(channels.has(channel), channel).toBe(true);
  });

  it('puts every registered channel in exactly one place: one operation, or the exclusion list', () => {
    const lost = [...channels].filter((c) => !named.includes(c) && !(c in EXCLUDED));
    expect(lost, `channels in no place (add an operation or an exclusion with its reason): ${lost.join(', ')}`).toEqual([]);
    const twice = [...channels].filter((c) => named.filter((n) => n === c).length + (c in EXCLUDED ? 1 : 0) > 1);
    expect(twice, `channels in two places: ${twice.join(', ')}`).toEqual([]);
  });

  it('names no channel that nothing registers', () => {
    const stale = [...named, ...Object.keys(EXCLUDED)].filter((c) => !channels.has(c));
    expect(stale).toEqual([]);
  });

  it('has 195 operations that wrap a channel and 141 exclusions, each with a known reason', () => {
    expect(named).toHaveLength(195);
    expect(Object.keys(EXCLUDED)).toHaveLength(141);
    for (const [channel, reason] of Object.entries(EXCLUDED)) expect(reason in EXCLUSION_REASONS, `${channel}: ${reason}`).toBe(true);
  });

  it('fails for a channel nobody classified: a made-up one is in no place', () => {
    const fake = new Set([...channels, 'board:invented']);
    expect([...fake].filter((c) => !named.includes(c) && !(c in EXCLUDED))).toEqual(['board:invented']);
  });

  it('has exactly the four door-only operations, each named in the table', () => {
    const doorOnly = OPS.filter((o) => o.channel === null).map(keyOf);
    expect(doorOnly.sort()).toEqual([...DOOR_ONLY].sort());
    expect(doorOnly).toHaveLength(4);
  });

  it('keeps out of the door the guard of the test workspace, the confirmations of its secrets, the update, pairing and every persona: channel', () => {
    for (const channel of ['workspace:test', 'config:testenv-confirm', 'config:testenv-revoke']) {
      expect(EXCLUDED[channel], channel).toBe('guard');
      expect(named).not.toContain(channel);
    }
    for (const channel of channels) {
      if (channel.startsWith('persona:')) {
        expect(named, channel).not.toContain(channel);
        expect(channel in EXCLUDED, channel).toBe(true);
      }
      if (channel.startsWith('update:')) expect(EXCLUDED[channel], channel).toBe('update');
      if (channel.startsWith('web:') || channel.startsWith('push:')) expect(EXCLUDED[channel], channel).toBe('pairing');
    }
    expect(OPS.some((o) => o.op.toLowerCase().includes('resume') || o.op.toLowerCase().includes('stop') && o.tool !== 'Runs')).toBe(false);
  });

  it('keeps the stop and the resume out of every operation, and the phone-scoped save out of the configuration tool', () => {
    for (const channel of PERSONA_STOP_CHANNELS) expect(named).not.toContain(channel);
    expect(named).not.toContain('config:cycle-save');
    expect(EXCLUDED['config:cycle-save']).toBe('scope');
    expect(opsOf('Settings').find((o) => o.op === 'set')?.channel).toBe('config:save');
  });

  it('has the eleven tools, each with operations, unique operation names of a plain shape, and a reason on every write', () => {
    expect(TOOL_NAMES).toHaveLength(11);
    for (const tool of TOOL_NAMES) {
      const ops = opsOf(tool);
      expect(ops.length, tool).toBeGreaterThan(1);
      const names = ops.map((o) => o.op);
      expect(new Set(names).size, `${tool}: ${names.join(', ')}`).toBe(names.length);
      for (const name of names) expect(name, `${tool}.${name}`).toMatch(/^[a-z][A-Za-z]*$/);
    }
    // `why` is the door's own argument for a write, so no operation may declare an argument of that name or `op`.
    for (const o of OPS) {
      expect(o.args.some((a) => a.name === 'why' || a.name === 'op'), keyOf(o)).toBe(false);
      expect(o.write || o.channel !== null || DOOR_ONLY.includes(keyOf(o) as (typeof DOOR_ONLY)[number])).toBe(true);
    }
  });

  it('gives one argument name one type inside a tool, so a flat schema can describe it once', () => {
    for (const tool of TOOL_NAMES) {
      const seen = new Map<string, string>();
      for (const o of opsOf(tool)) {
        for (const a of o.args) {
          const shape = `${a.type}:${(a.values ?? []).join('|')}`;
          const before = seen.get(a.name);
          expect(before === undefined || before === shape, `${tool}.${o.op}.${a.name}: ${shape} against ${before}`).toBe(true);
          seen.set(a.name, shape);
        }
      }
    }
  });

  it('marks as host text only arguments that exist and are text, and none of a forum post or a memory note', () => {
    for (const o of OPS) {
      for (const name of o.hostText ?? []) {
        const spec = o.args.find((a) => a.name === name);
        expect(spec?.type, `${keyOf(o)}.${name}`).toBe('text');
      }
    }
    expect(OPS.filter((o) => o.hostText).map(keyOf).sort()).toEqual(['Board.comment', 'Board.create', 'Board.update', 'Ceremonies.discussionsReply']);
  });

  it('does not import the policy of the phone', () => {
    for (const file of ['door.ts', 'doorOps.ts', 'doorTable.ts', 'args.ts', 'configPath.ts', 'footer.ts', 'session.ts']) {
      expect(readFileSync(join(SRC, 'persona', file), 'utf8'), file).not.toMatch(/webPolicy|webAccess|webRefusal/);
    }
  });
});
