import { VcsError } from '../../src/main/vcs/errors';
import { createGitHubProvider, validateGitHubCommand } from '../../src/main/vcs/github';
import type { VcsRuntime, VcsSettings } from '../../src/main/vcs/runtime';
import { type RestTransport, pagesOver } from '../../src/main/vcs/transport';
import type { VcsCommand } from '../../src/main/vcs/types';

// A code host with a memory: GitHub's shapes, answering the reads the runner makes from what the writes it received put there, and recording every write.
// It stands behind the real provider and the real validator of GitHub, so a command the app plans that the closed list would refuse fails here too.

export interface ForgeWrite {
  method: string;
  endpoint: string;
  json: Record<string, any>;
}

interface Note {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

interface Thread {
  id: string;
  path: string;
  line: number | null;
  resolved: boolean;
  comments: { databaseId: number; body: string }[];
}

export interface ForgePr {
  number: number;
  branch: string;
  head: string;
  base: string;
  files: { filename: string; patch: string }[];
  /** The pull request was merged (it reads as closed with a merge time). */
  merged?: boolean;
  /** Someone approved it (its reviews say so). */
  approved?: boolean;
  draft?: boolean;
  /** The branch comes from another repository. */
  fork?: boolean;
  /** Who approved it, and how the host knows them (default: `ana`, a member), and the commit the approval was given on (default: the head). */
  approval?: { by?: string; association?: string; commit?: string };
  /** Someone asked for changes on it (a review that is not over), by this login. */
  changesRequestedBy?: string;
  /** Who opened it (default: the forge's author, `someone-else` when not said). */
  author?: string;
  /** When the pull request was last updated, as the host says it (default: not said). */
  updatedAt?: string | null;
  /** The commit checks: `failing`, or `unreadable` (the host does not answer). Default: no checks. */
  checks?: 'failing' | 'unreadable';
  /** Its title and description (a description that says `Closes #N` links the issue). */
  title?: string;
  body?: string;
}

export const HEAD = 'aaaa111122223333aaaa111122223333aaaa1111';
export const PROJECT = 'group/project';

/** An issue the forge made when a write asked for one: what was sent, and whether it is closed. */
export interface ForgeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  milestone?: string | null;
  /** Who opened it (the user the app acts as when not said). */
  author?: string;
  /** It is a pull request (the issue search lists those too, flagged). */
  pull?: boolean;
}

/** A release the forge shows for a tag: a draft is not shown by the tags endpoint. */
export interface ForgeRelease {
  draft: boolean;
  prerelease: boolean;
  publishedAt: string | null;
}

export interface Forge {
  writes: ForgeWrite[];
  /** The issues the writes created, by number (101 is the one the runner tests start from and is not here). */
  issues: Map<number, ForgeIssue>;
  /** Closes an issue the forge made. */
  close(number: number): void;
  /** The notes of the issue 101 and of the pull request, by number. */
  notes: Map<number, Note[]>;
  threads: Thread[];
  reviews: { id: number; event: string; body: string; commit_id: string; comments: Record<string, any>[] }[];
  pr: ForgePr | null;
  /** The other pull requests of the forge (a release's activities): the reads by number, by target branch and by reviews see them with `pr`. */
  others: ForgePr[];
  /** The releases the forge shows, by tag. */
  releases: Map<string, ForgeRelease>;
  /** The pull request shows in the issue's timeline (a person opened it by hand, or it was made). */
  linked: boolean;
  /** The labels of the issue 101. */
  labels: string[];
  /** A comment a person wrote on an issue or a pull request, after the time given (the reply of a reporter). */
  say(number: number, login: string, body: string, at: string): void;
  /** A write to refuse with this status (every write while set). */
  failWith: { status: number; message: string } | null;
  runtime(): VcsRuntime;
  /** Notes of a target as `[id, body]`. */
  bodies(number: number): [number, string][];
}

export const PATCHES = {
  'src/feature.ts': '@@ -0,0 +1,3 @@\n+export const feature = 1;\n+export const other = 2;\n+export const third = 3;\n',
  'docs/notes.md': '@@ -1,2 +1,3 @@\n # Notes\n+A line.\n More.\n',
};

export function makeForge(over: { pr?: Partial<ForgePr> | null; linked?: boolean; author?: string } = {}): Forge {
  let nextId = 5000;
  let nextIssue = 200;
  const forge: Forge = {
    writes: [],
    issues: new Map(),
    close: (n) => {
      const found = forge.issues.get(n);
      if (found) found.state = 'closed';
    },
    notes: new Map([[101, []]]),
    threads: [],
    reviews: [],
    others: [],
    releases: new Map(),
    pr: over.pr === null ? null : { number: 7, branch: 'cycle/101-add-the-thing-101', head: HEAD, base: 'main', files: Object.entries(PATCHES).map(([filename, patch]) => ({ filename, patch })), ...over.pr },
    linked: over.linked ?? true,
    labels: [],
    say: (n, login, body, at) => void forge.notes.set(n, [...(forge.notes.get(n) ?? []), { id: nextId++, body, user: { login }, created_at: at }]),
    failWith: null,
    bodies: (n) => (forge.notes.get(n) ?? []).map((x) => [x.id, x.body]),
    runtime: () => runtime,
  };
  const url = (n: number, id: number): string => `https://example.test/${PROJECT}/${n === forge.pr?.number ? 'pull' : 'issues'}/${n}#issuecomment-${id}`;
  const note = (n: number, body: string): Note => {
    const made: Note = { id: nextId++, body, user: { login: 'runner-bot' }, created_at: '2026-10-03T12:00:00Z' };
    forge.notes.set(n, [...(forge.notes.get(n) ?? []), made]);
    return made;
  };
  const allPrs = (): ForgePr[] => [...(forge.pr ? [forge.pr] : []), ...forge.others];
  const prJson = (pr: ForgePr) => ({ number: pr.number, node_id: 'PR_kwDOAbCdEf4Abcd', title: pr.title ?? 'A pull request', state: pr.merged ? 'closed' : 'open', merged_at: pr.merged ? '2026-10-03T13:00:00Z' : null, ...(pr.updatedAt === null ? {} : { updated_at: pr.updatedAt ?? '2026-01-01T00:00:00Z' }), draft: !!pr.draft, head: { ref: pr.branch, sha: pr.head, repo: { full_name: pr.fork ? 'someone/project' : PROJECT } }, base: { ref: pr.base, repo: { full_name: PROJECT } }, html_url: `https://example.test/${PROJECT}/pull/${pr.number}`, user: { login: pr.author ?? over.author ?? 'someone-else' }, requested_reviewers: [], body: pr.body ?? '' });
  const threadNode = (t: Thread) => ({ id: t.id, isResolved: t.resolved, path: t.path, line: t.line, originalLine: t.line, comments: { nodes: t.comments.map((c) => ({ databaseId: c.databaseId, author: { login: 'runner-bot' }, body: c.body, createdAt: '2026-10-03T12:00:00Z', url: `https://example.test/${PROJECT}/pull/7#discussion_r${c.databaseId}` })) } });
  const openThread = (path: string, line: number | null, body: string): void => {
    const databaseId = nextId++;
    forge.threads.push({ id: `PRRT_kwDOforge${String(databaseId)}`, path, line, resolved: false, comments: [{ databaseId, body }] });
  };

  const get = async (endpoint: string): Promise<unknown> => {
    const path = endpoint.split('?')[0];
    let m: RegExpExecArray | null;
    if (path === 'user') return { id: 1, login: 'runner-bot', name: 'Runner' };
    if (path === `repos/${PROJECT}`) return { default_branch: 'main', html_url: `https://example.test/${PROJECT}`, full_name: PROJECT };
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(path))) return (forge.notes.get(Number(m[1])) ?? []).map((n) => ({ ...n, html_url: url(Number(m?.[1]), n.id) }));
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path)) && forge.issues.has(Number(m[1]))) {
      const made = forge.issues.get(Number(m[1])) as ForgeIssue;
      return { number: made.number, title: made.title, state: made.state, labels: made.labels.map((name) => ({ name })), html_url: `https://example.test/${PROJECT}/issues/${made.number}`, user: { login: 'runner-bot' }, assignees: [], body: made.body };
    }
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path))) return { number: Number(m[1]), title: 'Add the thing', state: 'open', labels: forge.labels.map((name) => ({ name })), html_url: `https://example.test/${PROJECT}/issues/${m[1]}`, user: { login: 'ana' }, assignees: [], body: '' };
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/timeline$/.exec(path))) return forge.linked && forge.pr ? [{ event: 'cross-referenced', source: { issue: { number: forge.pr.number, pull_request: {}, repository: { full_name: PROJECT } } } }] : [];
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/comments$/.exec(path))) return forge.threads.flatMap((t) => t.comments.map((c) => ({ id: c.databaseId, body: c.body, created_at: '2026-10-03T12:00:00Z', user: { login: 'runner-bot' } })));
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviews$/.exec(path))) {
      const found = allPrs().find((x) => x.number === Number(m?.[1]));
      if (!found) return [];
      return [
        ...(found.approved ? [{ user: { login: found.approval?.by ?? 'ana' }, state: 'APPROVED', submitted_at: '2026-10-03T12:00:00Z', commit_id: found.approval?.commit ?? found.head, author_association: found.approval?.association ?? 'MEMBER' }] : []),
        ...(found.changesRequestedBy ? [{ user: { login: found.changesRequestedBy }, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-03T12:01:00Z', commit_id: found.head, author_association: 'MEMBER' }] : []),
      ];
    }
    if ((m = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)\/(check-runs|status)$/.exec(path))) {
      const owner = allPrs().find((x) => x.head === m?.[1]);
      if (owner?.checks === 'unreadable') throw new Error('the host does not answer');
      if (m[2] === 'status') return { state: 'pending', statuses: [] };
      return { check_runs: owner?.checks === 'failing' ? [{ status: 'completed', conclusion: 'failure' }] : [] };
    }
    if (/^repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
      const base = new URLSearchParams(endpoint.split('?')[1] ?? '').get('base');
      return allPrs().filter((x) => !base || x.base === base).map(prJson);
    }
    if (path === 'search/issues') {
      const q = new URLSearchParams(endpoint.split('?')[1] ?? '').get('q') ?? '';
      const label = /label:"([^"]+)"/.exec(q)?.[1];
      const items = [...forge.issues.values()].filter((i) => i.state === 'open' && (!label || i.labels.includes(label))).map((i) => ({ number: i.number, title: i.title, state: i.state, labels: i.labels.map((name) => ({ name })), html_url: `https://example.test/${PROJECT}/issues/${i.number}`, user: { login: i.author ?? 'runner-bot' }, assignees: [], body: i.body, ...(i.pull ? { pull_request: {} } : {}), milestone: i.milestone ? { title: i.milestone } : null }));
      return { items };
    }
    if ((m = /^repos\/[^/]+\/[^/]+\/releases\/tags\/([\w.%-]+)$/.exec(path))) {
      const tag = decodeURIComponent(m[1]);
      const rel = forge.releases.get(tag);
      if (!rel || rel.draft) throw new VcsError('not_found', { host: 'example.test', what: tag });
      return { tag_name: tag, name: tag, draft: false, prerelease: rel.prerelease, published_at: rel.publishedAt, html_url: `https://example.test/${PROJECT}/releases/tag/${tag}` };
    }
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files$/.exec(path))) return forge.pr?.number === Number(m[1]) ? forge.pr.files : [];
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(path))) {
      const found = allPrs().find((x) => x.number === Number(m?.[1]));
      if (!found) throw new Error('not found');
      return prJson(found);
    }
    throw new Error(`the fake forge has nothing at ${endpoint}`);
  };
  const transport: RestTransport = {
    kind: 'api',
    get: get as RestTransport['get'],
    pages: pagesOver(get),
    graphql: (async () => ({ data: { repository: { pullRequest: { reviewThreads: { nodes: forge.threads.map(threadNode) } } } } })) as RestTransport['graphql'],
  };

  const run: VcsRuntime['exec']['run'] = async (command: VcsCommand, meta) => {
    validateGitHubCommand(command);
    if (forge.failWith) {
      if (meta) meta.code = forge.failWith.status;
      throw new Error(forge.failWith.message);
    }
    // An upload of evidence: the forge answers the address a comment embeds the image by; its body is the file on disk, never a JSON field.
    if (command.bodyFile) {
      forge.writes.push({ method: command.method, endpoint: command.endpoint, json: { headers: command.headers ?? {} } });
      const name = new URLSearchParams(command.endpoint.split('?')[1] ?? '').get('name') ?? 'file';
      const response = { url: `https://example.test/${PROJECT}/assets/${name}` };
      if (meta) {
        meta.code = 201;
        meta.response = response;
      }
      return JSON.stringify(response).slice(0, 2000);
    }
    const json = command.json ? (JSON.parse(command.json) as Record<string, any>) : {};
    forge.writes.push({ method: command.method, endpoint: command.endpoint, json: command.endpoint === 'graphql' ? { query: command.fields.query } : json });
    let response: unknown = {};
    let m: RegExpExecArray | null;
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(command.endpoint)) && command.method === 'POST') {
      const made = note(Number(m[1]), json.body);
      response = { id: made.id, html_url: url(Number(m[1]), made.id) };
    } else if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(command.endpoint)) && command.method === 'PATCH' && json.state === 'closed') {
      const found = forge.issues.get(Number(m[1]));
      if (!found) throw new Error('404 not found');
      found.state = 'closed';
    } else if ((m = /^repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(command.endpoint)) && command.method === 'PATCH') {
      const all = [...forge.notes.values()].flat();
      const found = all.find((n) => n.id === Number(m?.[1]));
      if (!found) throw new Error('404 not found');
      found.body = json.body;
      response = { id: found.id };
    } else if (command.method === 'POST' && new RegExp(`^repos/${PROJECT}/issues$`).test(command.endpoint)) {
      const number = nextIssue++;
      forge.issues.set(number, { number, title: json.title, body: json.body, labels: json.labels ?? [], state: 'open' });
      forge.notes.set(number, []);
      response = { number, id: number * 1000, html_url: `https://example.test/${PROJECT}/issues/${number}` };
    } else if (command.method === 'DELETE' && (m = /^repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(command.endpoint))) {
      const id = Number(m[1]);
      if (![...forge.notes.values()].flat().some((n) => n.id === id)) throw new Error('404 not found');
      for (const [number, list] of forge.notes) forge.notes.set(number, list.filter((n) => n.id !== id));
    } else if (command.method === 'DELETE' && (m = /^repos\/[^/]+\/[^/]+\/pulls\/comments\/(\d+)$/.exec(command.endpoint))) {
      const id = Number(m[1]);
      if (!forge.threads.some((t) => t.comments.some((c) => c.databaseId === id))) throw new Error('404 not found');
      for (const t of forge.threads) t.comments = t.comments.filter((c) => c.databaseId !== id);
      forge.threads = forge.threads.filter((t) => t.comments.length);
    } else if ((m = /^repos\/[^/]+\/[^/]+\/issues\/\d+\/labels$/.exec(command.endpoint)) && command.method === 'POST') {
      forge.labels = [...new Set([...forge.labels, ...(json.labels as string[])])];
    } else if ((m = /^repos\/[^/]+\/[^/]+\/issues\/\d+\/labels\/([\w%.-]+)$/.exec(command.endpoint)) && command.method === 'DELETE') {
      forge.labels = forge.labels.filter((l) => l !== decodeURIComponent(m?.[1] ?? ''));
    } else if (/\/pulls\/\d+\/reviews$/.test(command.endpoint)) {
      const id = nextId++;
      forge.reviews.push({ id, event: json.event, body: json.body, commit_id: json.commit_id, comments: json.comments });
      for (const c of json.comments as { path: string; line: number; body: string }[]) openThread(c.path, c.line, c.body);
      response = { id, html_url: `https://example.test/${PROJECT}/pull/7#pullrequestreview-${id}` };
    } else if (/\/pulls\/\d+\/comments$/.test(command.endpoint)) {
      openThread(json.path, null, json.body);
      response = { id: nextId - 1 };
    } else if ((m = /\/pulls\/\d+\/comments\/(\d+)\/replies$/.exec(command.endpoint))) {
      const t = forge.threads.find((x) => x.comments[0].databaseId === Number(m?.[1]));
      if (!t) throw new Error('404 not found');
      t.comments.push({ databaseId: nextId++, body: json.body });
      response = { id: nextId - 1 };
    } else if (command.endpoint === 'graphql') {
      const id = /threadId: "([\w=-]+)"/.exec(command.fields.query)?.[1];
      const t = forge.threads.find((x) => x.id === id);
      if (!t) throw new Error('404 not found');
      t.resolved = true;
      response = { data: { resolveReviewThread: { thread: { isResolved: true } } } };
    } else if (command.method === 'POST' && new RegExp(`^repos/${PROJECT}/pulls$`).test(command.endpoint)) {
      forge.pr = { number: 7, branch: json.head, head: HEAD, base: json.base, files: Object.entries(PATCHES).map(([filename, patch]) => ({ filename, patch })) };
      forge.linked = true;
      response = { number: 7, html_url: `https://example.test/${PROJECT}/pull/7` };
    } else {
      throw new Error(`the fake forge does not know ${command.method} ${command.endpoint}`);
    }
    if (meta) {
      meta.code = 201;
      meta.response = response;
    }
    return JSON.stringify(response).slice(0, 2000);
  };

  const settings: VcsSettings = { id: 'gh', kind: 'github', host: 'example.test', apiUrl: '', user: 'runner-bot', secretRef: null, cli: 'gh', preference: 'api', repos: [PROJECT] };
  const runtime: VcsRuntime = { settings, provider: createGitHubProvider({ id: 'gh', host: 'example.test', transport, token: () => 'TESTTOKEN-not-real-0001' }), exec: { run } };
  return forge;
}
