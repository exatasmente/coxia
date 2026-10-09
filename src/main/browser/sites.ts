import { existsSync } from 'node:fs';
import type { ProfileSite, RevokeResult, SitesResult } from '../../shared/browser';
import type { BrowserRuntime } from './launch';
import { type ProfileLocks, ProfileError, deleteProfile, openProfile, profileDirOf, profileLocks } from './profile';

// What an agent's logged-in browser holds, site by site, and taking one site (or all) away. Both are done by the browser itself, started on the closed profile with no window
// and no network: the app parses no database and never sees a value. Code runs in the server the app started for this alone, with no agent in it; the strings below are the
// only code it is ever given, and a site is put into one only after it was checked to be a host name. Listing and clearing are refused while a screen of the agent holds the
// profile, and the profile is locked for the time they take.

/**
 * What reads the profile: every site that holds a cookie, with its counts. The cookies are read in the server and only their number per host leaves it. The browser lists no
 * storage of its own accord (a closed profile has no origins to ask), so each site that holds a cookie is asked on a page the browser itself fills with nothing: every request
 * is answered before it reaches the network, and with no network there is none to reach. A site that keeps a login in its local storage alone, with no cookie, is not found
 * here; Revoke all clears it.
 */
export const LIST_CODE = `async (page) => {
  const context = page.context();
  const sites = Object.create(null);
  const row = (site) => (sites[site] ??= { site, cookies: 0, storage: 0 });
  for (const c of await context.cookies()) row(String(c.domain).replace(/^\\./, '').toLowerCase()).cookies++;
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  for (const site of Object.keys(sites)) {
    try {
      await page.goto('https://' + site + '/', { waitUntil: 'commit' });
      sites[site].storage = await page.evaluate(async () => {
        let n = localStorage.length;
        try { n += (await indexedDB.databases()).length; } catch {}
        return n;
      });
    } catch {}
  }
  await page.unroute('**/*');
  return Object.values(sites);
}`;

/** The host names a site can be: what the listing writes, nothing a quote or a space could get through. */
const SITE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
export const isSite = (value: unknown): value is string => typeof value === 'string' && SITE.test(value);

/** What takes one site away: its cookies (the host and its leading-dot form) and everything its origin keeps. `site` is a checked host name. */
export function revokeCode(site: string): string {
  return `async (page) => {
  const site = ${JSON.stringify(site)};
  const context = page.context();
  // The site is a checked host name: only its dots mean anything to a pattern.
  await context.clearCookies({ domain: new RegExp('^\\\\.?' + site.split('.').join('\\\\.') + '$') });
  const cdp = await context.newCDPSession(page);
  for (const origin of ['https://' + site, 'http://' + site]) await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  return 'cleared';
}`;
}

/** The sites the server answered with, as counts; anything else it said is dropped. null for an answer that is not a list. */
export function parseSites(answer: string): ProfileSite[] | null {
  const at = answer.indexOf('### Result');
  if (at < 0 || answer.includes('### Error')) return null;
  const body = answer.slice(at + '### Result'.length).trim().split(/\n###/)[0].trim();
  try {
    const raw: unknown = JSON.parse(body);
    if (!Array.isArray(raw)) return null;
    const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1_000_000) : 0);
    return raw
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && isSite((r as Record<string, unknown>).site))
      .map((r) => ({ site: String(r.site), cookies: count(r.cookies), storage: count(r.storage) }))
      .filter((s) => s.cookies + s.storage > 0)
      .sort((a, b) => a.site.localeCompare(b.site));
  } catch {
    return null;
  }
}

export interface SitesDeps {
  /** The workspace folder that holds `browser/<agent>/`. */
  workspaceDir: string;
  /** Starts a browser with no window and no network on the profile folder it is given. */
  launch(profileDir: string): Promise<BrowserRuntime>;
  locks?: ProfileLocks;
}

const ownerOf = (agentId: string): string => `sites:${agentId}`;

type Ran<T> = { ok: true; value: T } | { ok: false; why: 'agent' | 'open' | 'busy' | 'browser' | 'failed'; detail?: string };

/** Locks the profile, starts the browser on it, runs `use`, and lets everything go however it ends. */
async function withProfile<T>(agentId: string, deps: SitesDeps, use: (runtime: BrowserRuntime) => Promise<T>): Promise<Ran<T>> {
  const locks = deps.locks ?? profileLocks;
  let opened: ReturnType<typeof openProfile>;
  try {
    opened = openProfile(deps.workspaceDir, agentId, ownerOf(agentId), { locks });
  } catch (e) {
    return { ok: false, why: e instanceof ProfileError && e.code === 'id' ? 'agent' : 'failed', detail: e instanceof ProfileError ? e.code : undefined };
  }
  if (!opened.ok) return { ok: false, why: opened.owner === ownerOf(agentId) ? 'busy' : 'open' };
  let runtime: BrowserRuntime | null = null;
  try {
    runtime = await deps.launch(opened.dir);
    return { ok: true, value: await use(runtime) };
  } catch (e) {
    return { ok: false, why: runtime ? 'failed' : 'browser', detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  } finally {
    await runtime?.close().catch(() => undefined);
    opened.release();
  }
}

const SERVER_MS = 30_000;

async function readSites(runtime: BrowserRuntime): Promise<ProfileSite[]> {
  const r = await runtime.client.callTool('browser_run_code_unsafe', { code: LIST_CODE }, { timeoutMs: SERVER_MS });
  const sites = parseSites(r.content.map((c) => (c.type === 'text' ? String((c as { text?: unknown }).text ?? '') : '')).join('\n'));
  if (!sites) throw new Error('the browser did not answer with a list of sites');
  return sites;
}

/** The sites that hold something in the agent's profile. A profile that was never made holds nothing, and is not made to find out. */
export async function listSites(agentId: string, deps: SitesDeps): Promise<SitesResult> {
  let dir: string;
  try {
    dir = profileDirOf(deps.workspaceDir, agentId);
  } catch {
    return { ok: false, why: 'agent' };
  }
  const holder = (deps.locks ?? profileLocks).holder(dir);
  if (holder !== null) return { ok: false, why: holder === ownerOf(agentId) ? 'busy' : 'open' };
  if (!existsSync(dir)) return { ok: true, sites: [] };
  const ran = await withProfile(agentId, deps, readSites);
  return ran.ok ? { ok: true, sites: ran.value } : ran;
}

/** Takes one site away from the profile: its cookies and its storage. Returns what the profile holds after. */
export async function revokeSite(agentId: string, site: string, deps: SitesDeps): Promise<RevokeResult> {
  if (!isSite(site)) return { ok: false, why: 'site' };
  let dir: string;
  try {
    dir = profileDirOf(deps.workspaceDir, agentId);
  } catch {
    return { ok: false, why: 'agent' };
  }
  const holder = (deps.locks ?? profileLocks).holder(dir);
  if (holder !== null) return { ok: false, why: holder === ownerOf(agentId) ? 'busy' : 'open' };
  if (!existsSync(dir)) return { ok: true, removed: false, sites: [] };
  const ran = await withProfile(agentId, deps, async (runtime) => {
    await runtime.client.callTool('browser_run_code_unsafe', { code: revokeCode(site) }, { timeoutMs: SERVER_MS });
    return readSites(runtime);
  });
  return ran.ok ? { ok: true, removed: !ran.value.some((s) => s.site === site), sites: ran.value } : ran;
}

/** Deletes the whole profile, whatever it holds. Always works, unless a screen holds it: then nothing is touched. A new empty profile is made at the next use. */
export function revokeAll(agentId: string, deps: Pick<SitesDeps, 'workspaceDir' | 'locks'>): RevokeResult {
  let dir: string;
  try {
    dir = profileDirOf(deps.workspaceDir, agentId);
  } catch {
    return { ok: false, why: 'agent' };
  }
  const holder = (deps.locks ?? profileLocks).holder(dir);
  if (holder !== null) return { ok: false, why: holder === ownerOf(agentId) ? 'busy' : 'open' };
  const r = deleteProfile(deps.workspaceDir, agentId, deps.locks ?? profileLocks);
  if (r.held) return { ok: false, why: 'open' };
  return r.removed ? { ok: true, removed: true, sites: [] } : { ok: false, why: 'failed' };
}

export interface SitesApiDeps extends Pick<SitesDeps, 'locks' | 'launch'> {
  /** The ids of the agents in the config. */
  agents(): string[];
  workspaceDir(): string;
}

/** The two calls Settings makes, with the checks of who may be asked about: only an agent that is in the team, and a site that is a host name. */
export function createSitesApi(d: SitesApiDeps) {
  const deps = (): SitesDeps => ({ workspaceDir: d.workspaceDir(), launch: d.launch, locks: d.locks });
  const known = (agent: unknown): agent is string => typeof agent === 'string' && d.agents().includes(agent);
  return {
    sites: async (agent: unknown): Promise<SitesResult> => (known(agent) ? listSites(agent, deps()) : { ok: false, why: 'agent' }),
    /** One site, or all of them when no site is given. */
    revoke: async (agent: unknown, site?: unknown): Promise<RevokeResult> => {
      if (!known(agent)) return { ok: false, why: 'agent' };
      return site === undefined || site === null ? revokeAll(agent, deps()) : revokeSite(agent, String(site), deps());
    },
  };
}
