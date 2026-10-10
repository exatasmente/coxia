import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SECRET_GLOBS, secretPath } from '../src/main/agents';
import { ATAS } from '../src/main/env';
import { DENIAL_CODES, checkPath } from '../src/main/engine/guard';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { policyFromHooks } from '../src/main/engine/open/policy';
import { restRegistry } from '../src/main/engine/open/rest';
import type { PoolMember } from '../src/main/engine/open/pool';
import type { ToolContext } from '../src/main/engine/open/tools/types';
import { editTool, writeTool } from '../src/main/engine/open/tools/write';
import { confinedHooks, readConfinedHooks } from '../src/main/runner/hooks';
import { type Fake, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

// The app's memory folder is outside every worktree, and `runner.unconfined` lifts that fence: with it on, a writing run agent could `Write` a note by path and bypass the
// validator, the ownership, the review wait and the caps. The write guard refuses the folder (`kept`) whatever `anywhere` says, in both engines and through links; reads
// are not judged by it. This also tightens `activities.json` and `procedures/`, which a file tool had no business writing either.

let base: string;
let root: string;
let ws: string;
let kept: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'memory-guard-'));
  root = join(base, 'wt');
  ws = join(base, 'workspace');
  kept = join(ws, 'memory');
  outside = join(base, 'elsewhere');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(kept, 'conversations/general/developer'), { recursive: true });
  mkdirSync(join(kept, 'procedures'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(kept, 'activities.json'), '{"version":1}\n');
  writeFileSync(join(kept, 'procedures/p-00000001.json'), '{}\n');
  writeFileSync(join(kept, 'conversations/general/developer/m-3fa91c02.md'), '---\nid: m-3fa91c02\n---\nbody\n');
  writeFileSync(join(outside, 'target.txt'), 'outside\n');
  symlinkSync(kept, join(root, 'memory-link'));
  symlinkSync(join(kept, 'conversations'), join(outside, 'conversations-link'));
  symlinkSync(kept, join(base, 'data-alias'));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const code = (input: unknown, opts = {}): string => {
  const r = checkPath(root, input, { isSecret: (p) => secretPath(p, root), keep: [kept], anywhere: true, ...opts });
  return r.ok ? 'ok' : r.code;
};

describe('the path guard keeps the memory folder from a write, with the fence lifted', () => {
  it('names the denial: a code of its own, so the agent is told what the folder is', () => {
    expect(DENIAL_CODES).toContain('kept');
  });

  it('refuses a note, the activities record, a procedure and the folder itself, by absolute path', () => {
    expect(code(join(kept, 'conversations/general/developer/m-3fa91c02.md'))).toBe('kept');
    expect(code(join(kept, 'conversations/general/developer/m-newnote0.md'))).toBe('kept');
    expect(code(join(kept, 'conversations/new-conversation/dev/_state.json'))).toBe('kept');
    expect(code(join(kept, 'activities.json'))).toBe('kept');
    expect(code(join(kept, 'procedures/p-00000001.json'))).toBe('kept');
    expect(code(join(kept, 'procedures/deleted.json'))).toBe('kept');
    expect(code(kept)).toBe('kept');
    expect(code(join(kept, 'a-folder-that-does-not-exist-yet/x'))).toBe('kept');
  });

  it('refuses it through .. and through ~, and by any spelling of the case', () => {
    expect(code('../workspace/memory/activities.json')).toBe('kept');
    expect(code(join(root, 'src/../../workspace/memory/activities.json'))).toBe('kept');
    expect(code('~/workspace/memory/activities.json', { home: base })).toBe('kept');
    expect(code(join(ws, 'MEMORY/Activities.json'))).toBe('kept');
  });

  it('refuses it through a link: one in the worktree, one elsewhere, and a data folder reached through a link', () => {
    expect(code('memory-link/activities.json')).toBe('kept');
    expect(code('memory-link/conversations/general/developer/m-newnote0.md')).toBe('kept');
    expect(code(join(outside, 'conversations-link/general/developer/m-newnote0.md'))).toBe('kept');
    // the kept folder named through a link, and a write through the real path
    expect(code(join(base, 'data-alias/activities.json'))).toBe('kept');
    expect(code(join(kept, 'activities.json'), { keep: [join(base, 'data-alias')] })).toBe('kept');
  });

  it('still lets a write elsewhere through, the worktree and outside it, and a sibling whose name only starts the same', () => {
    expect(code('src/a.ts')).toBe('ok');
    expect(code(join(outside, 'new.txt'))).toBe('ok');
    expect(code(join(ws, 'memory-notes/x.md'))).toBe('ok');
    expect(code(join(ws, 'config.json'))).toBe('ok');
    expect(code(join(ws, 'worktrees/x/y.ts'))).toBe('ok');
  });

  it('does not judge a read: the folder stays readable where the run could already read it (spec rule 4)', () => {
    expect(code(join(kept, 'conversations/general/developer/m-3fa91c02.md'), { read: true })).toBe('ok');
    expect(code(join(kept, 'activities.json'), { read: true })).toBe('ok');
    expect(code(kept, { read: true })).toBe('ok');
    expect(code('memory-link/activities.json', { read: true })).toBe('ok');
  });

  it('does not change a call that names no kept folder, with the fence lifted or not', () => {
    expect(code(join(kept, 'activities.json'), { keep: undefined })).toBe('ok');
    expect(code(join(kept, 'activities.json'), { keep: [] })).toBe('ok');
    expect(code(join(kept, 'activities.json'), { keep: ['relative/memory'] })).toBe('ok');
    expect(code(join(kept, 'activities.json'), { anywhere: false })).toBe('outside');
    expect(code(join(outside, 'x.txt'), { anywhere: false })).toBe('outside');
    expect(code('src/a.ts', { anywhere: false })).toBe('ok');
    expect(code('../x', { anywhere: false })).toBe('traversal');
  });

  it('refuses a kept folder inside the worktree too, so the guard does not depend on the fence being lifted', () => {
    const inside = join(root, 'src');
    expect(code(join(inside, 'a.ts'), { keep: [inside], anywhere: false })).toBe('kept');
    expect(code('src/a.ts', { keep: [inside], anywhere: false })).toBe('kept');
  });
});

describe('the Claude SDK\'s write hook', () => {
  const policy = (o: Parameters<typeof confinedHooks>[0]) => policyFromHooks(confinedHooks(o), 's1');

  it('refuses Write, Edit, MultiEdit and NotebookEdit into the folder with the fence lifted, and says what the folder is', async () => {
    const p = policy({ root, commands: [], anywhere: true, keep: [kept] });
    const note = join(kept, 'conversations/general/developer/m-3fa91c02.md');
    for (const [tool, args] of [['Write', { file_path: note, content: 'x' }], ['Edit', { file_path: note, old_string: 'a', new_string: 'b' }], ['MultiEdit', { file_path: note, edits: [] }], ['NotebookEdit', { notebook_path: note }]] as const) {
      expect(await p.pre(tool, args, root), tool).toMatch(/memória|memory/i);
    }
    expect(await p.pre('Write', { file_path: join(kept, 'activities.json'), content: 'x' }, root)).toMatch(/memória|memory/i);
    expect(await p.pre('Write', { file_path: join(kept, 'procedures/p-00000002.json'), content: 'x' }, root)).toMatch(/memória|memory/i);
    expect(await p.pre('Write', { file_path: 'memory-link/activities.json', content: 'x' }, root)).toMatch(/memória|memory/i);
  });

  it('reports the refusal to the run, with the code', async () => {
    const seen: string[] = [];
    const p = policy({ root, commands: [], anywhere: true, keep: [kept], onDenied: (d) => seen.push(`${d.tool}:${d.code}`) });
    await p.pre('Write', { file_path: join(kept, 'activities.json'), content: 'x' }, root);
    expect(seen).toEqual(['Write:kept']);
  });

  it('keeps the workspace\'s own memory folder when no folder is named: the default is <workspace>/memory', async () => {
    const p = policy({ root, commands: [], anywhere: true });
    expect(await p.pre('Write', { file_path: join(ATAS, 'memory', 'conversations', 'general', 'developer', 'm-3fa91c02.md'), content: 'x' }, root)).toMatch(/memória|memory/i);
    expect(await p.pre('Write', { file_path: join(ATAS, 'memory', 'activities.json'), content: 'x' }, root)).toMatch(/memória|memory/i);
    expect(await p.pre('Write', { file_path: join(outside, 'made.txt'), content: 'x' }, root)).toBeNull();
  });

  it('lets a write in the worktree through, and does not change a call with the fence up', async () => {
    const p = policy({ root, commands: [], keep: [kept] });
    expect(await p.pre('Write', { file_path: join(root, 'src/b.ts'), content: 'x' }, root)).toBeNull();
    expect(await p.pre('Write', { file_path: join(kept, 'activities.json'), content: 'x' }, root)).toMatch(/fora da pasta|outside/i);
  });

  it('keeps a narrow write folder narrow: a documentation run\'s fence is the same, the memory is outside it', async () => {
    const p = policy({ root, writeRoot: join(root, 'src'), commands: [], anywhere: true, keep: [kept] });
    expect(await p.pre('Write', { file_path: join(kept, 'activities.json'), content: 'x' }, root)).toMatch(/fora da pasta|outside|memória|memory/i);
  });

  it('does not stop a reader: the hooks of a reading agent are untouched and the folder is readable', async () => {
    const reader = policyFromHooks(readConfinedHooks({ root, roots: [], anywhere: true }), 's1');
    expect(await reader.pre('Read', { file_path: join(kept, 'activities.json') }, root)).toBeNull();
    expect(await reader.pre('Read', { file_path: join(kept, 'conversations/general/developer/m-3fa91c02.md') }, root)).toBeNull();
  });
});

describe('the open engine\'s Write and Edit', () => {
  const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({ cwd: root, roots: [root], isSecret: (p) => secretPath(p, root), secretGlobs: SECRET_GLOBS, outputMax: 30_000, env: {}, bashPrefixes: [], ripgrep: 'off', writeRoot: root, ...over });
  const noteFile = (): string => join(kept, 'conversations/general/developer/m-3fa91c02.md');

  it('refuse the folder with the fence lifted, whether the file is there or not, and leave it as it was', async () => {
    const on = ctx({ writeAnywhere: true, writeKeep: [kept] });
    const note = noteFile();
    const before = readFileSync(note, 'utf8');
    await expect(writeTool.run({ file_path: note, content: 'x' }, on)).rejects.toThrow(/memória|memory/i);
    await expect(writeTool.run({ file_path: join(kept, 'conversations/general/developer/m-newnote0.md'), content: 'x' }, on)).rejects.toThrow(/memória|memory/i);
    await expect(writeTool.run({ file_path: join(kept, 'activities.json'), content: 'x' }, on)).rejects.toThrow(/memória|memory/i);
    await expect(writeTool.run({ file_path: 'memory-link/procedures/p-00000009.json', content: 'x' }, on)).rejects.toThrow(/memória|memory/i);
    await expect(editTool.run({ file_path: note, old_string: 'body', new_string: 'changed' }, on)).rejects.toThrow(/memória|memory/i);
    expect(readFileSync(note, 'utf8')).toBe(before);
    expect(existsSync(join(kept, 'conversations/general/developer/m-newnote0.md'))).toBe(false);
    expect(existsSync(join(kept, 'procedures/p-00000009.json'))).toBe(false);
  });

  it('agree with the SDK hook: the same paths pass and the same are refused', async () => {
    const on = ctx({ writeAnywhere: true, writeKeep: [kept] });
    const hook = policyFromHooks(confinedHooks({ root, commands: [], anywhere: true, keep: [kept] }), 's1');
    for (const [path, refused] of [[noteFile(), true], [join(kept, 'activities.json'), true], ['memory-link/activities.json', true], [join(outside, 'agree.txt'), false], [join(root, 'src/agree.ts'), false]] as const) {
      expect(!!(await hook.pre('Write', { file_path: path, content: 'x' }, root)), path).toBe(refused);
      const open = await writeTool.run({ file_path: path, content: 'x' }, on).then(() => false, () => true);
      expect(open, path).toBe(refused);
    }
  });

  it('write outside the worktree only with the fence lifted, and nothing changes without a kept folder', async () => {
    const target = join(outside, 'open-engine.txt');
    await expect(writeTool.run({ file_path: target, content: 'x' }, ctx({ writeKeep: [kept] }))).rejects.toThrow(/outside|fora/i);
    await writeTool.run({ file_path: target, content: 'hello\n' }, ctx({ writeAnywhere: true, writeKeep: [kept] }));
    expect(readFileSync(target, 'utf8')).toBe('hello\n');
    await writeTool.run({ file_path: join(kept, 'procedures/p-00000003.json'), content: '{}' }, ctx({ writeAnywhere: true }));
    expect(existsSync(join(kept, 'procedures/p-00000003.json'))).toBe(true);
  });
});

describe('a sub-agent of the open engine', () => {
  let fakes: Fake[] = [];
  let sessions: string;
  afterEach(async () => {
    await Promise.all(fakes.map((f) => f.close()));
    fakes = [];
    restRegistry.clear();
  });

  const member = (f: Fake, name: string): PoolMember => ({ key: `key-${name}`, label: `model-${name}`, model: `model-${name}`, provider: `prov-${name}`, client: new ChatClient({ baseUrl: f.url, model: `model-${name}`, retryDelayMs: 0, maxRetries: 0 }) });

  it('inherits the guard: an edit sub-agent that writes into the kept folder is refused, and the principal goes on', async () => {
    sessions = mkdtempSync(join(base, 'sessions-'));
    const target = join(kept, 'conversations/general/developer/m-subagent.md');
    const main = await fakeOpenAI((req) => {
      if (req.n === 1) return toolStep([{ id: 'c1', name: 'Agent', args: { description: 'go', prompt: 'write the note', kind: 'edit' } }], { usageTokens: [10, 2] });
      return textStep('principal done', { usageTokens: [10, 2] });
    });
    const sub = await fakeOpenAI((req) => (req.body?.messages.at(-1).role === 'tool' ? textStep('the write was refused', { usageTokens: [10, 2] }) : toolStep([{ id: 'w1', name: 'Write', args: { file_path: target, content: 'x' } }], { usageTokens: [10, 2] })));
    fakes.push(main, sub);
    const p: OpenRunParams = {
      role: 'deep',
      prompt: 'main task',
      client: member(main, 'a').client,
      pool: { name: 'deep', primary: { key: 'key-a', label: 'model-a', provider: 'prov-a' }, fallbacks: [], activities: { edit: [member(sub, 'b')] }, mode: 'delegate' },
      cwd: root,
      allowedTools: ['Agent', 'Write', 'Edit'],
      writeRoot: root,
      writeAnywhere: true,
      writeKeep: [kept],
      isSecret: (x) => secretPath(x, root),
      docs: {},
      maxTurns: 8,
      sessionsDir: sessions,
      ripgrep: 'off',
    };
    const r = await runOpen<string>(p);
    expect(r.data).toBe('principal done');
    expect(sub.chats()).toHaveLength(2);
    const refusal = (sub.chats()[1].body?.messages ?? []).find((m: { role: string }) => m.role === 'tool');
    expect(String(refusal?.content)).toMatch(/memória|memory/i);
    expect(existsSync(target)).toBe(false);
  });
});
