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
}

export const HEAD = 'aaaa111122223333aaaa111122223333aaaa1111';
export const PROJECT = 'group/project';

export interface Forge {
  writes: ForgeWrite[];
  /** The notes of the issue 101 and of the pull request, by number. */
  notes: Map<number, Note[]>;
  threads: Thread[];
  reviews: { id: number; event: string; body: string; commit_id: string; comments: Record<string, any>[] }[];
  pr: ForgePr | null;
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
  const forge: Forge = {
    writes: [],
    notes: new Map([[101, []]]),
    threads: [],
    reviews: [],
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
  const prJson = (pr: ForgePr) => ({ number: pr.number, node_id: 'PR_kwDOAbCdEf4Abcd', title: 'A pull request', state: pr.merged ? 'closed' : 'open', merged_at: pr.merged ? '2026-10-03T13:00:00Z' : null, head: { ref: pr.branch, sha: pr.head }, base: { ref: pr.base }, html_url: `https://example.test/${PROJECT}/pull/${pr.number}`, user: { login: over.author ?? 'someone-else' }, requested_reviewers: [], body: '' });
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
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path))) return { number: Number(m[1]), title: 'Add the thing', state: 'open', labels: forge.labels.map((name) => ({ name })), html_url: `https://example.test/${PROJECT}/issues/${m[1]}`, user: { login: 'ana' }, assignees: [], body: '' };
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/timeline$/.exec(path))) return forge.linked && forge.pr ? [{ event: 'cross-referenced', source: { issue: { number: forge.pr.number, pull_request: {}, repository: { full_name: PROJECT } } } }] : [];
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/comments$/.exec(path))) return forge.threads.flatMap((t) => t.comments.map((c) => ({ id: c.databaseId, body: c.body, created_at: '2026-10-03T12:00:00Z', user: { login: 'runner-bot' } })));
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files$/.exec(path))) return forge.pr?.number === Number(m[1]) ? forge.pr.files : [];
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(path))) {
      if (forge.pr?.number !== Number(m[1])) throw new Error('not found');
      return prJson(forge.pr);
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
    const json = command.json ? (JSON.parse(command.json) as Record<string, any>) : {};
    forge.writes.push({ method: command.method, endpoint: command.endpoint, json: command.endpoint === 'graphql' ? { query: command.fields.query } : json });
    let response: unknown = {};
    let m: RegExpExecArray | null;
    if ((m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(command.endpoint)) && command.method === 'POST') {
      const made = note(Number(m[1]), json.body);
      response = { id: made.id, html_url: url(Number(m[1]), made.id) };
    } else if ((m = /^repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(command.endpoint)) && command.method === 'PATCH') {
      const all = [...forge.notes.values()].flat();
      const found = all.find((n) => n.id === Number(m?.[1]));
      if (!found) throw new Error('404 not found');
      found.body = json.body;
      response = { id: found.id };
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
  const runtime: VcsRuntime = { settings, provider: createGitHubProvider({ id: 'gh', host: 'example.test', transport }), exec: { run } };
  return forge;
}
