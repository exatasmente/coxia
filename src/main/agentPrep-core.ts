import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { NAMES_SHOWN, type DocsProposal, type FolderScan, type ProjectScan, type ProposedDocs, type ScanResult, type UserScan } from '../shared/agentPrep';
import { expandHome, shrinkHome } from '../shared/config/paths';
import type { DocsConfig, Language, WorkspaceConfig } from '../shared/config/types';
import { createTranslator, type Translate } from '../shared/i18n';

// "Preparar agentes": looks at the projects of a workspace and at ~/.claude, lists what an agent can use as context (CLAUDE.md, skills, rules,
// agents, knowledge bases, MCP configs, a specs folder) and proposes the docs section of the config. No model is involved here; the optional
// summary call is in agentPrep.ts. Everything is read-only, and nothing secret is read: .env files, keys and an MCP server's settings are
// never opened (only the server names of .mcp.json are).

const MAX_FILES = 2000;
const MAX_REPOS = 80;
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', '.venv', '__pycache__']);

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

function entries(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => !n.startsWith('.') && !SKIP_DIR.has(n))
      .sort();
  } catch {
    return [];
  }
}

// Markdown files under a folder, to a small depth.
function markdownFiles(dir: string, depth = 3, budget = { n: MAX_FILES }): string[] {
  const out: string[] = [];
  for (const name of entries(dir)) {
    if (budget.n <= 0) break;
    const path = join(dir, name);
    if (isDir(path)) {
      if (depth > 1) out.push(...markdownFiles(path, depth - 1, budget));
    } else if (/\.(md|mdx)$/i.test(name)) {
      out.push(path);
      budget.n--;
    }
  }
  return out;
}

/** A folder of skills: each skill is a subfolder with a SKILL.md. */
function skillsFolder(dir: string): FolderScan | null {
  if (!isDir(dir)) return null;
  const names = entries(dir).filter((n) => isFile(join(dir, n, 'SKILL.md')));
  return names.length ? { dir, count: names.length, names: names.slice(0, NAMES_SHOWN) } : null;
}

/** A folder of markdown documents (rules, knowledge base, docs); the names are the entries at the top of the folder. */
function documentsFolder(dir: string): FolderScan | null {
  if (!isDir(dir)) return null;
  const files = markdownFiles(dir);
  if (!files.length) return null;
  return { dir, count: files.length, names: entries(dir).slice(0, NAMES_SHOWN) };
}

/** A folder of agent or command files: one markdown file each. */
function filesFolder(dir: string): FolderScan | null {
  if (!isDir(dir)) return null;
  const files = markdownFiles(dir, 2);
  return files.length ? { dir, count: files.length, names: files.map((f) => basename(f).replace(/\.mdx?$/i, '')).slice(0, NAMES_SHOWN) } : null;
}

/** The first folder of the candidates that holds documents. */
function firstDocuments(base: string, candidates: string[]): FolderScan | null {
  for (const c of candidates) {
    const found = documentsFolder(join(base, c));
    if (found) return found;
  }
  return null;
}

// A folder of issue specs has one subfolder per issue, named "#123-slug" or "123-slug".
function specsFolder(base: string): FolderScan | null {
  for (const c of ['.specs', 'specs', 'docs/specs']) {
    const dir = join(base, c);
    if (!isDir(dir)) continue;
    // entries() hides dot and build folders; a spec folder named "#123-slug" is none of those.
    const names = entries(dir).filter((n) => /^#?\d+-/.test(n) && isDir(join(dir, n)));
    if (names.length) return { dir, count: names.length, names: names.slice(0, NAMES_SHOWN) };
  }
  return null;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readText(path: string, max = 6000): string {
  try {
    return readFileSync(path, 'utf8').slice(0, max);
  } catch {
    return '';
  }
}

const NODE_FRAMEWORKS: [string, string][] = [
  ['react', 'React'],
  ['vue', 'Vue'],
  ['next', 'Next.js'],
  ['@angular/core', 'Angular'],
  ['svelte', 'Svelte'],
  ['express', 'Express'],
  ['@nestjs/core', 'NestJS'],
  ['electron', 'Electron'],
  ['vite', 'Vite'],
  ['typescript', 'TypeScript'],
];

const PYTHON_FRAMEWORKS: [string, string][] = [
  ['django', 'Django'],
  ['flask', 'Flask'],
  ['fastapi', 'FastAPI'],
];

interface Manifest {
  name: string | null;
  description: string | null;
  stack: string[];
}

/** Languages and frameworks from the manifests at the top of the project. Only names are read; scripts and settings are not. */
function manifest(path: string): Manifest {
  const stack: string[] = [];
  let name: string | null = null;
  let description: string | null = null;
  const pkg = readJson(join(path, 'package.json'));
  if (pkg) {
    name = typeof pkg.name === 'string' ? pkg.name : null;
    description = typeof pkg.description === 'string' ? pkg.description : null;
    const deps = { ...(pkg.dependencies as Record<string, unknown> | undefined), ...(pkg.devDependencies as Record<string, unknown> | undefined) };
    stack.push('Node.js', ...NODE_FRAMEWORKS.filter(([dep]) => dep in deps).map(([, label]) => label));
  }
  const composer = readJson(join(path, 'composer.json'));
  if (composer) {
    name ??= typeof composer.name === 'string' ? composer.name : null;
    description ??= typeof composer.description === 'string' ? composer.description : null;
    stack.push('PHP');
    if ((composer.require as Record<string, unknown> | undefined)?.['laravel/framework']) stack.push('Laravel');
  }
  const goMod = readText(join(path, 'go.mod'), 400);
  if (goMod) {
    stack.push('Go');
    name ??= /^module\s+(\S+)/m.exec(goMod)?.[1] ?? null;
  }
  const py = `${readText(join(path, 'pyproject.toml'), 3000)}\n${readText(join(path, 'requirements.txt'), 3000)}`.toLowerCase();
  if (isFile(join(path, 'pyproject.toml')) || isFile(join(path, 'requirements.txt'))) {
    stack.push('Python', ...PYTHON_FRAMEWORKS.filter(([dep]) => py.includes(dep)).map(([, label]) => label));
    name ??= /^name\s*=\s*"([^"]+)"/m.exec(py)?.[1] ?? null;
  }
  if (isFile(join(path, 'Cargo.toml'))) stack.push('Rust');
  const gemfile = readText(join(path, 'Gemfile'), 2000);
  if (gemfile) stack.push('Ruby', ...(gemfile.includes('rails') ? ['Rails'] : []));
  if (isFile(join(path, 'pom.xml')) || isFile(join(path, 'build.gradle')) || isFile(join(path, 'build.gradle.kts'))) stack.push('Java/Kotlin');
  if (isFile(join(path, 'pubspec.yaml'))) stack.push('Dart/Flutter');
  if (isFile(join(path, 'Dockerfile')) || isFile(join(path, 'docker-compose.yml'))) stack.push('Docker');
  return { name, description, stack: [...new Set(stack)] };
}

/** The first paragraph of prose of a markdown file: no headings, quotes, code, imports or tables. */
export function firstParagraph(markdown: string, max = 240): string {
  let inFence = false;
  const para: string[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const prose = line && !/^(#|>|@|---|\||[-*+]\s|\d+\.\s|<|!\[|\[!)/.test(line);
    if (prose) para.push(line);
    else if (para.length) break;
  }
  const text = para.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return sentence > 40 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max)}…`;
}

function mcpServers(file: string): string[] {
  const json = readJson(file);
  const servers = json?.mcpServers;
  // Names only: the settings of a server (command, env) are never read into the result.
  return typeof servers === 'object' && servers !== null ? Object.keys(servers).sort() : [];
}

export interface ScanTarget {
  id: string;
  path: string;
}

function describe(scan: Omit<ProjectScan, 'summary'>, tr: Translate): string {
  const bits: string[] = [];
  if (scan.stack.length) bits.push(tr('agents.scan.stack', { stack: scan.stack.join(', ') }));
  const parts = [
    scan.claudeMd ? tr('agents.scan.claudeMd') : '',
    scan.skills ? tr('agents.scan.skills', { count: scan.skills.count }) : '',
    scan.rules ? tr('agents.scan.rules', { count: scan.rules.count }) : '',
    scan.agents ? tr('agents.scan.agents', { count: scan.agents.count }) : '',
    scan.knowledge ? tr('agents.scan.knowledge', { count: scan.knowledge.count }) : '',
    scan.mcpServers.length ? tr('agents.scan.mcp', { count: scan.mcpServers.length }) : '',
  ].filter(Boolean);
  bits.push(parts.length ? tr('agents.scan.context', { list: parts.join(', ') }) : tr('agents.scan.nothing'));
  return [scan.purpose, bits.join(' ')].filter(Boolean).join(' ');
}

/** Everything the scan can tell about one project folder. */
export function scanProject(target: ScanTarget, tr: Translate): ProjectScan {
  const path = target.path;
  if (!isDir(path)) {
    const base = { id: target.id, path, exists: false, isGitRepo: false, name: target.id, claudeMd: null, skills: null, rules: null, agents: null, commands: null, knowledge: null, docs: null, mcpConfig: null, mcpServers: [], specsDir: null, stack: [], purpose: '' };
    return { ...base, summary: tr('agents.scan.missing') };
  }
  const claude = join(path, '.claude');
  const m = manifest(path);
  const claudeMd = isFile(join(path, 'CLAUDE.md')) ? join(path, 'CLAUDE.md') : isFile(join(claude, 'CLAUDE.md')) ? join(claude, 'CLAUDE.md') : null;
  const readme = ['README.md', 'README.mdx', 'readme.md'].map((f) => join(path, f)).find(isFile);
  const purpose = firstParagraph(claudeMd ? readText(claudeMd) : '') || firstParagraph(readme ? readText(readme) : '') || (m.description ?? '');
  const mcp = join(path, '.mcp.json');
  const base: Omit<ProjectScan, 'summary'> = {
    id: target.id,
    path,
    exists: true,
    isGitRepo: existsSync(join(path, '.git')),
    name: m.name ?? basename(path),
    claudeMd,
    skills: skillsFolder(join(claude, 'skills')),
    rules: documentsFolder(join(claude, 'rules')),
    agents: filesFolder(join(claude, 'agents')),
    commands: filesFolder(join(claude, 'commands')),
    knowledge: firstDocuments(path, ['.claude/knowledge-base', '.claude/knowledge', 'knowledge-base', 'knowledge']),
    docs: documentsFolder(join(path, 'docs')),
    mcpConfig: isFile(mcp) ? mcp : null,
    mcpServers: isFile(mcp) ? mcpServers(mcp) : [],
    specsDir: specsFolder(path),
    stack: m.stack,
    purpose,
  };
  return { ...base, summary: describe(base, tr) };
}

export function scanUser(home: string): UserScan {
  const claude = join(home, '.claude');
  return {
    claudeMd: isFile(join(claude, 'CLAUDE.md')) ? join(claude, 'CLAUDE.md') : null,
    skills: skillsFolder(join(claude, 'skills')),
    agents: filesFolder(join(claude, 'agents')),
    commands: filesFolder(join(claude, 'commands')),
  };
}

/**
 * The folders to scan for a workspace config: the repos it lists, the roots themselves (a root may carry its own CLAUDE.md) and, with
 * autoDiscover, the git repos directly under each root.
 */
export function targetsOf(config: WorkspaceConfig, home: string): ScanTarget[] {
  const out = new Map<string, ScanTarget>();
  const add = (id: string, path: string) => {
    if (!out.has(path)) out.set(path, { id, path });
  };
  for (const r of config.projects.repos) add(r.id, expandHome(r.path, home));
  for (const root of config.projects.roots.map((r) => expandHome(r, home))) {
    // A root is a project of its own only when it carries context (a CLAUDE.md or a .claude folder); otherwise it is just a folder of repos.
    if (existsSync(join(root, 'CLAUDE.md')) || isDir(join(root, '.claude'))) add(basename(root), root);
    if (!config.projects.autoDiscover) continue;
    for (const name of entries(root).slice(0, 400)) {
      if (out.size >= MAX_REPOS) break;
      if (existsSync(join(root, name, '.git'))) add(name, join(root, name));
    }
  }
  return [...out.values()];
}

export function scanWorkspace(targets: ScanTarget[], home: string, language: Language, now = new Date()): ScanResult {
  const tr = createTranslator(language);
  const projects = targets.map((t) => scanProject(t, tr));
  return { generatedAt: now.toISOString(), user: scanUser(home), projects, missing: projects.filter((p) => !p.exists).map((p) => p.path) };
}

const uniq = (list: string[]): string[] => [...new Set(list)];

/**
 * The docs section the scan suggests. What the workspace already lists stays first; what the scan found is added after it, with "~/" for
 * paths under the home folder. A plain `docs/` folder is mentioned in the notes but not added: it is usually not agent context.
 */
export function proposeDocs(scan: ScanResult, current: DocsConfig | null, home: string, language: Language): DocsProposal {
  const tr = createTranslator(language);
  const short = (p: string) => shrinkHome(p, home);
  const found = scan.projects.filter((p) => p.exists);
  const user = scan.user;
  const specs = [...found].filter((p) => p.specsDir).sort((a, b) => (b.specsDir?.count ?? 0) - (a.specsDir?.count ?? 0))[0]?.specsDir ?? null;
  const docs: ProposedDocs = {
    claudeMdRoots: uniq([...(current?.claudeMdRoots ?? []), ...found.filter((p) => p.claudeMd).map((p) => short(dirname(p.claudeMd as string).replace(/\/\.claude$/, ''))), ...(user.claudeMd ? [short(dirname(user.claudeMd))] : [])]),
    skillsDirs: uniq([...(current?.skillsDirs ?? []), ...found.flatMap((p) => (p.skills ? [short(p.skills.dir)] : [])), ...(user.skills ? [short(user.skills.dir)] : [])]),
    rulesDirs: uniq([...(current?.rulesDirs ?? []), ...found.flatMap((p) => (p.rules ? [short(p.rules.dir)] : []))]),
    agentsDirs: uniq([...(current?.agentsDirs ?? []), ...found.flatMap((p) => (p.agents ? [short(p.agents.dir)] : [])), ...(user.agents ? [short(user.agents.dir)] : [])]),
    knowledgeDirs: uniq([...(current?.knowledgeDirs ?? []), ...found.flatMap((p) => (p.knowledge ? [short(p.knowledge.dir)] : []))]),
    mcpConfigFiles: uniq([...(current?.mcpConfigFiles ?? []), ...found.flatMap((p) => (p.mcpConfig ? [short(p.mcpConfig)] : []))]),
    specsDir: current?.specsDir ?? (specs ? short(specs.dir) : null),
  };
  const notes: string[] = [];
  for (const p of found) if (p.docs && !p.knowledge) notes.push(tr('agents.scan.noteDocs', { project: p.id, count: p.docs.count }));
  for (const p of scan.projects.filter((x) => !x.exists)) notes.push(tr('agents.scan.noteMissing', { path: short(p.path) }));
  if (specs && !current?.specsDir) notes.push(tr('agents.scan.noteSpecs', { dir: short(specs.dir), count: specs.count }));
  for (const p of found.filter((x) => x.mcpConfig)) notes.push(tr('agents.scan.noteMcp', { project: p.id, servers: p.mcpServers.join(', ') || '-' }));
  return { docs, notes };
}

/** The config with the proposed docs written into it. Only the docs section changes; autoDetect is left as it was. */
export function applyDocs(config: WorkspaceConfig, docs: ProposedDocs): WorkspaceConfig {
  return { ...structuredClone(config), docs: { ...config.docs, ...docs } };
}
