// i18n-lint: allow-file what an agent reads from the memory: English by design, like the other tool texts of the engines
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceConfig } from '../../shared/config/types';
import { expandHome } from '../../shared/config/paths';
import { isTerminal, type Run } from '../../shared/runs';
import { redact } from '../errorlog-core';
import { git } from '../conflictGit';
import { SAFE } from '../runner/git';
import { findSection, headingsOf, sectionText, type Heading } from './documents';

// The two facts the memory gives an agent besides notes: the version of the product and the roadmap. Neither has a source in the app but the repositories of the workspace
// and a file the person points at, so they are read here, by the app, never by asking an agent to run git. An agent whose source is empty is told so ("unknown", "none"),
// and nothing is guessed. Git is the one slow input: a call on a voice path reads the cache only and lets a refresh run in the background.

const TTL_MS = 10 * 60 * 1000;
const GIT_TIMEOUT_MS = 1500;
const ROADMAP_MAX_BYTES = 200 * 1024;
const MANIFEST_MAX_BYTES = 256 * 1024;
const LINE_CLIP = 200;
const SECTIONS_IN_LINE = 6;

/** What one repository says about its version: its newest tag, its newest stable tag and the version in its manifest. Each may be missing. */
export interface RepoVersion {
  repo: string;
  latest: string | null;
  stable: string | null;
  manifest: string | null;
  /** The file the manifest version was read from. */
  manifestFile: string | null;
}

export interface VersionFact {
  /** `ok`: at least one source answered; `unknown`: none did; `cold`: nothing was read yet and the call could not wait for it. */
  state: 'ok' | 'unknown' | 'cold';
  repos: RepoVersion[];
  /** The versions of the release runs that are open. */
  releases: string[];
  /** The one line the list carries. */
  line: string;
}

export interface RoadmapFact {
  state: 'ok' | 'none' | 'unreadable';
  title: string | null;
  headings: Heading[];
  text: string;
  line: string;
}

export interface FactsDeps {
  config(): WorkspaceConfig;
  /** Whether the app's secret filter holds a path back (`secretPath`): the roadmap is not read from one. */
  secret(path: string): boolean;
  now?(): number;
  home?: string;
  /** The tags of a repository (`v<digits>…`), or null when they could not be read. A test passes a fake; the default asks git, 1.5 s at most, never a fetch. */
  tags?(cwd: string): Promise<string[] | null>;
}

export interface Facts {
  /** `cacheOnly`: never wait for git; a repository not read yet is `cold` and a refresh starts in the background. */
  version(runs: readonly Run[], opts?: { cacheOnly?: boolean }): Promise<VersionFact>;
  roadmap(): RoadmapFact;
  /** Reads every repository's version now (the module does this at start, so a voice call finds the cache warm). */
  warm(): Promise<void>;
}

// --- tags --------------------------------------------------------------------------------------------------------------------------

interface Semver {
  core: [number, number, number];
  pre: string[] | null;
}

const SEMVER = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseTag(tag: string): Semver | null {
  const m = SEMVER.exec(tag.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : null };
}

/** Semver order: the core first; a pre-release is lower than its release; pre-release identifiers by number when both are numbers, else as text. */
export function compareTags(a: string, b: string): number {
  const x = parseTag(a);
  const y = parseTag(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn) return -1;
    if (qn) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** The newest tag and the newest stable one (no pre-release) of a list. Tags that are not `v<major>.<minor>.<patch>[-pre]` are ignored. */
export function newestTags(tags: readonly string[]): { latest: string | null; stable: string | null } {
  const valid = tags.map((t) => t.trim()).filter((t) => parseTag(t));
  const top = (list: string[]): string | null => list.reduce<string | null>((best, t) => (best === null || compareTags(t, best) > 0 ? t : best), null);
  return { latest: top(valid), stable: top(valid.filter((t) => !parseTag(t)?.pre)) };
}

const readTags = async (cwd: string): Promise<string[] | null> => {
  const r = await git(cwd, [...SAFE, 'tag', '--list', 'v[0-9]*'], { fail: false, timeout: GIT_TIMEOUT_MS });
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : null;
};

// --- manifests ----------------------------------------------------------------------------------------------------------------------

const VERSION_TEXT = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

function fileText(path: string): string | null {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MANIFEST_MAX_BYTES) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The `version = "x"` of a TOML section (`[project]` or `[package]`): the first one before the next section header. */
export function tomlVersion(text: string, section: string): string | null {
  let inside = false;
  for (const row of text.split('\n')) {
    const line = row.trim();
    const head = /^\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (head) {
      inside = head[1].trim() === section;
      continue;
    }
    if (!inside) continue;
    const m = /^version\s*=\s*["']([^"']+)["']/.exec(line);
    if (m) return VERSION_TEXT.test(m[1]) ? m[1] : null;
  }
  return null;
}

/** The version of a repository's manifest: `package.json`, else `pyproject.toml`, else `Cargo.toml`. */
export function manifestOf(dir: string): { version: string; file: string } | null {
  const pkg = fileText(join(dir, 'package.json'));
  if (pkg !== null) {
    try {
      const v = (JSON.parse(pkg) as { version?: unknown }).version;
      if (typeof v === 'string' && VERSION_TEXT.test(v)) return { version: v, file: 'package.json' };
    } catch {
      // not json: it says no version
    }
  }
  for (const [file, section] of [['pyproject.toml', 'project'], ['Cargo.toml', 'package']] as const) {
    const text = fileText(join(dir, file));
    const v = text === null ? null : tomlVersion(text, section);
    if (v) return { version: v, file };
  }
  return null;
}

// --- the facts ---------------------------------------------------------------------------------------------------------------------

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function repoPart(v: RepoVersion): string {
  const bits = [v.latest ? `latest ${v.latest}` : '', v.stable ? `stable ${v.stable}` : '', v.manifest ? `manifest ${v.manifest}` : ''].filter(Boolean);
  return bits.length ? `${v.repo} ${bits.join(', ')}` : '';
}

export function versionLine(repos: readonly RepoVersion[], releases: readonly string[], cold: boolean): string {
  const parts = [...repos.map(repoPart).filter(Boolean), ...(releases.length ? [`release in progress ${releases.join(', ')}`] : [])];
  if (parts.length) return `Version: ${parts.join('; ')}`;
  return cold ? 'Version: not read yet' : 'Version: unknown (no tag or manifest was found)';
}

export function createFacts(deps: FactsDeps): Facts {
  const now = deps.now ?? Date.now;
  const home = deps.home ?? homedir();
  const tagsOf = deps.tags ?? readTags;
  const cache = new Map<string, { at: number; value: RepoVersion }>();
  const inflight = new Map<string, Promise<RepoVersion>>();
  let roadmapCache: { key: string; fact: RoadmapFact } | null = null;

  const reposOf = (): { id: string; path: string }[] =>
    deps.config().projects.repos.flatMap((r) => {
      const path = expandHome(r.path, home);
      return existsSync(path) ? [{ id: r.id, path }] : [];
    });

  async function read(repo: { id: string; path: string }): Promise<RepoVersion> {
    const tags = await tagsOf(repo.path).catch(() => null);
    const newest = newestTags(tags ?? []);
    const manifest = manifestOf(repo.path);
    return { repo: repo.id, latest: newest.latest, stable: newest.stable, manifest: manifest?.version ?? null, manifestFile: manifest?.file ?? null };
  }

  // One refresh per repository at a time, so a burst of calls does not start a burst of git processes.
  function refresh(repo: { id: string; path: string }): Promise<RepoVersion> {
    const running = inflight.get(repo.path);
    if (running) return running;
    const p = read(repo)
      .then((value) => {
        cache.set(repo.path, { at: now(), value });
        return value;
      })
      .finally(() => inflight.delete(repo.path));
    inflight.set(repo.path, p);
    return p;
  }

  return {
    async version(runs, opts = {}) {
      const releases = [...new Set(runs.filter((r) => r.subject?.kind === 'release' && !isTerminal(r)).map((r) => r.subject?.version ?? '').filter(Boolean))];
      let cold = 0;
      // The repositories are read at once (each with its own git timeout), and the answer keeps the order of the configuration.
      const reads = reposOf().map((repo): Promise<RepoVersion | null> | RepoVersion | null => {
        const hit = cache.get(repo.path);
        if (hit !== undefined && now() - hit.at < TTL_MS) return hit.value;
        if (!opts.cacheOnly) return refresh(repo);
        // Stale is still an answer from earlier; nothing at all is "not read yet".
        void refresh(repo).catch(() => undefined);
        if (!hit) cold++;
        return hit ? hit.value : null;
      });
      const found = (await Promise.all(reads)).filter((v): v is RepoVersion => v !== null);
      const any = found.some((v) => repoPart(v)) || releases.length > 0;
      return { state: any ? 'ok' : cold ? 'cold' : 'unknown', repos: found, releases, line: versionLine(found, releases, cold > 0) };
    },

    roadmap() {
      const pointer = deps.config().docs.roadmapFile;
      if (!pointer || !pointer.trim()) return roadmapFact('none', 'Roadmap: none (no file is configured)');
      const path = expandHome(pointer.trim(), home);
      let st;
      try {
        st = lstatSync(path);
      } catch {
        return roadmapFact('unreadable', 'Roadmap: none (the file could not be read)');
      }
      if (!st.isFile() || st.isSymbolicLink() || st.size > ROADMAP_MAX_BYTES || deps.secret(path)) return roadmapFact('unreadable', 'Roadmap: none (the file could not be read)');
      const key = `${path}:${st.mtimeMs}:${st.size}`;
      if (roadmapCache?.key === key) return roadmapCache.fact;
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        return roadmapFact('unreadable', 'Roadmap: none (the file could not be read)');
      }
      const text = redact(raw, home);
      const headings = headingsOf(text);
      const second = headings.filter((h) => h.level === 2).slice(0, SECTIONS_IN_LINE).map((h) => h.title);
      const title = headings[0]?.title ?? null;
      const head = `Roadmap: ${title ?? 'untitled'} (${headings.length} sections)`;
      const fact: RoadmapFact = { state: 'ok', title, headings, text, line: second.length ? `${head}: ${clip(second.join('; '), LINE_CLIP)}` : head };
      roadmapCache = { key, fact };
      return fact;
    },

    async warm() {
      await Promise.all(reposOf().map((r) => refresh(r).catch(() => undefined)));
    },
  };
}

function roadmapFact(state: RoadmapFact['state'], line: string): RoadmapFact {
  return { state, title: null, headings: [], text: '', line };
}

/** One section of the roadmap by name, or the roadmap's outline when no section is asked for. Null when the name matches nothing. */
export function roadmapSection(fact: RoadmapFact, name: string | undefined): { text: string; outline: string[] } | null {
  const outline = fact.headings.map((h) => `${'  '.repeat(h.level - 1)}${h.title}`);
  if (!name || !name.trim()) return { text: fact.text, outline };
  const at = findSection(fact.headings, name);
  return at < 0 ? null : { text: sectionText(fact.text, fact.headings, at), outline };
}

/** The per-repository detail `memory_read('sys:version')` answers. */
export function versionDetail(fact: VersionFact): string {
  const lines = fact.repos.map((v) => {
    const bits = [
      v.latest ? `newest tag ${v.latest}` : 'no release tag',
      v.stable ? `newest stable tag ${v.stable}` : 'no stable tag',
      v.manifest ? `manifest ${v.manifest} (${v.manifestFile})` : 'no manifest version',
    ];
    return `${v.repo}: ${bits.join(', ')}`;
  });
  if (fact.releases.length) lines.push(`Release in progress: ${fact.releases.join(', ')}`);
  return lines.length ? lines.join('\n') : fact.line;
}
