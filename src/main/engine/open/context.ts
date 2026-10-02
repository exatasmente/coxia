// Context like Claude Code's: CLAUDE.md with @imports, skills (description in the prompt, body on demand), agent definitions and an
// index of reference docs. Everything comes from configurable paths; nothing is hard-wired to one workspace.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ToolImpl } from './tools/types';
import { ToolError, clip } from './tools/types';
import { t } from '../../../shared/i18n';

export interface DocSources {
  // CLAUDE.md files, or folders that hold CLAUDE.md or .claude/CLAUDE.md.
  claudeMd?: string[];
  // Folders of <name>/SKILL.md.
  skillDirs?: string[];
  // Folders of <name>.md agent definitions (frontmatter name, description).
  agentDirs?: string[];
  // Folders of reference docs (rules, knowledge base): indexed by name and read on demand with Read.
  docDirs?: string[];
  // .mcp.json style files.
  mcpConfigs?: string[];
  // Characters of CLAUDE.md the prompt may carry.
  claudeMdMax?: number;
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

function readText(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

// @path references outside code fences and code spans, preceded by whitespace; the path must exist, so "@someone" stays text.
function importsOf(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const noSpans = line.replace(/`[^`]*`/g, '');
    for (const m of noSpans.matchAll(/(?:^|\s)@([^\s]+)/g)) out.push(m[1].replace(/[.,;:)\]]+$/, ''));
  }
  return out;
}

export interface LoadedClaudeMd {
  text: string;
  files: string[];
}

export function loadClaudeMd(sources: string[], max = 60_000): LoadedClaudeMd {
  const files: string[] = [];
  const parts: string[] = [];
  const seen = new Set<string>();
  const load = (file: string, depth: number): void => {
    const abs = resolve(file);
    if (seen.has(abs) || depth > 5) return;
    const text = readText(abs);
    if (text === null) return;
    seen.add(abs);
    files.push(abs);
    parts.push(`Contents of ${abs}:\n\n${text.trim()}`);
    for (const ref of importsOf(text)) {
      const target = ref.startsWith('~/') ? join(homedir(), ref.slice(2)) : resolve(dirname(abs), ref);
      if (existsSync(target)) load(target, depth + 1);
    }
  };
  for (const s of sources) {
    const abs = resolve(s);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) load(abs, 0);
    else for (const c of [join(abs, 'CLAUDE.md'), join(abs, '.claude', 'CLAUDE.md')]) load(c, 0);
  }
  return { text: clip(parts.join('\n\n---\n\n'), max), files };
}

// CLAUDE.md files from the cwd up to the home folder, farthest first (the nearest instructions come last, so they win).
export function discoverClaudeMd(cwd: string): string[] {
  const out: string[] = [];
  const home = homedir();
  let dir = resolve(cwd);
  for (let i = 0; i < 12; i++) {
    for (const c of [join(dir, 'CLAUDE.md'), join(dir, '.claude', 'CLAUDE.md')]) if (readText(c) !== null) out.unshift(c);
    if (dir === home || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  const user = join(home, '.claude', 'CLAUDE.md');
  if (readText(user) !== null) out.unshift(user);
  return out;
}

export interface Skill {
  name: string;
  description: string;
  file: string;
}

export function loadSkills(dirs: string[]): Skill[] {
  const out = new Map<string, Skill>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names.sort()) {
      const file = join(dir, n, 'SKILL.md');
      const text = readText(file);
      if (text === null) continue;
      const { meta } = parseFrontmatter(text);
      const name = meta.name || n;
      if (!out.has(name)) out.set(name, { name, description: meta.description ?? '', file });
    }
  }
  return [...out.values()];
}

export interface AgentDef {
  name: string;
  description: string;
  body: string;
  tools?: string[];
}

export function loadAgentDefs(dirs: string[]): AgentDef[] {
  const out = new Map<string, AgentDef>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names.filter((f) => f.endsWith('.md')).sort()) {
      const text = readText(join(dir, n));
      if (text === null) continue;
      const { meta, body } = parseFrontmatter(text);
      const name = meta.name || n.replace(/\.md$/, '');
      if (!out.has(name)) {
        out.set(name, { name, description: meta.description ?? '', body: body.trim(), tools: meta.tools ? meta.tools.split(',').map((t) => t.trim()) : undefined });
      }
    }
  }
  return [...out.values()];
}

export function docIndex(dirs: string[], limit = 120): string[] {
  const out: string[] = [];
  const stack = [...dirs];
  while (stack.length && out.length < limit) {
    const dir = stack.shift() as string;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const n of names) {
      const p = join(dir, n);
      try {
        if (statSync(p).isDirectory()) stack.push(p);
        else if (/\.(md|txt)$/i.test(n) && out.length < limit) out.push(p);
      } catch {
        // skip
      }
    }
  }
  return out;
}

export function skillTool(skills: Skill[]): ToolImpl {
  return {
    name: 'Skill',
    description: 'Loads the full instructions of one skill listed in the system prompt. Call it when the task matches the skill description, then follow what it says.',
    parameters: {
      type: 'object',
      properties: { skill: { type: 'string', description: 'Skill name, exactly as listed' }, args: { type: 'string', description: 'Optional arguments' } },
      required: ['skill'],
    },
    async run(input, ctx) {
      const name = String(input.skill ?? '').replace(/^\//, '');
      const found = skills.find((s) => s.name === name);
      if (!found) throw new ToolError(t('main.engine.text.unknownSkill', { name, available: skills.map((s) => s.name).join(', ') }));
      const body = parseFrontmatter(readFileSync(found.file, 'utf8')).body.trim();
      return { response: `Base directory for this skill: ${dirname(found.file)}\n\n${body}`, render: (r) => clip(String(r), ctx.outputMax) };
    },
  };
}

export interface PromptParts {
  cwd: string;
  claudeMd?: string;
  skills?: Skill[];
  agents?: AgentDef[];
  docs?: string[];
  append?: string;
  toolNames: string[];
  now?: Date;
}

const GUIDE =
  'You are an autonomous assistant that answers by using tools. Think step by step, call the tools you need (several at once when they are independent), ' +
  'read the results, and only then answer. Never invent file contents, command output or identifiers: if you did not read it, say you did not. ' +
  'Tools are read-only. Keep going until the task is done, then give the final answer in the format requested.';

export function buildSystemPrompt(p: PromptParts): string {
  const sections: string[] = [GUIDE];
  sections.push(
    `Environment:\n- Working directory: ${p.cwd}\n- Platform: ${process.platform}\n- Date: ${(p.now ?? new Date()).toISOString().slice(0, 10)}\n- Tools: ${p.toolNames.join(', ') || '(none)'}`,
  );
  if (p.claudeMd) sections.push(`Project instructions (CLAUDE.md). Follow them:\n\n${p.claudeMd}`);
  if (p.skills?.length) {
    sections.push(`Skills (call the Skill tool with the name to load one):\n${p.skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`);
  }
  if (p.agents?.length) {
    sections.push(`Agents (call the Agent tool with subagent_type to delegate a focused task):\n${p.agents.map((a) => `- ${a.name}: ${a.description}`).join('\n')}`);
  }
  if (p.docs?.length) sections.push(`Reference docs you may read with Read when the task needs them:\n${p.docs.map((d) => `- ${d}`).join('\n')}`);
  if (p.append) sections.push(p.append);
  return sections.join('\n\n');
}
