import type { VcsCommand } from '../../src/shared/types';
import { VcsError } from '../../src/main/vcs/errors';
import type { VcsRuntime } from '../../src/main/vcs/runtime';
import { fakeGitlabRuntime } from './vcs';

// A code host for the board's tests: a GitLab on a fake transport that holds issues, answers the reads the board makes (a listing of a project, an issue by number)
// and records every write the door sends it. Nothing here reaches a network.

export interface FakeIssue {
  project: string;
  iid: number;
  title: string;
  state: 'opened' | 'closed';
  labels: string[];
  updatedAt: string;
  description?: string;
  /** Listed for the person's own scope (`assigned_to_me`), as an issue assigned to them is. */
  mine?: boolean;
  comments: string[];
}

export interface FakeBoardHost {
  issues: FakeIssue[];
  /** Every GET the provider made, as the endpoint it asked for. */
  reads: string[];
  /** Every write command the executor was handed, in order. */
  commands: VcsCommand[];
  /** The next write throws this once. */
  failNext: string | null;
  /** Answer a creation without a number. */
  noNumber: boolean;
  runtime: VcsRuntime;
  add(project: string, iid: number, over?: Partial<FakeIssue>): FakeIssue;
  find(project: string, iid: number): FakeIssue | undefined;
}

const urlOf = (project: string, iid: number): string => `https://git.acme.test/${project}/-/issues/${iid}`;

function row(i: FakeIssue): Record<string, unknown> {
  return {
    iid: i.iid,
    title: i.title,
    state: i.state,
    labels: i.labels,
    web_url: urlOf(i.project, i.iid),
    updated_at: i.updatedAt,
    description: i.description ?? '',
    references: { full: `${i.project}#${i.iid}` },
    assignees: [],
    milestone: null,
  };
}

export function fakeBoardHost(): FakeBoardHost {
  const host: FakeBoardHost = {
    issues: [],
    reads: [],
    commands: [],
    failNext: null,
    noNumber: false,
    runtime: undefined as unknown as VcsRuntime,
    add(project, iid, over = {}) {
      const issue: FakeIssue = { project, iid, title: `Issue ${iid}`, state: 'opened', labels: [], updatedAt: '2026-10-07T10:00:00Z', comments: [], ...over };
      host.issues.push(issue);
      return issue;
    },
    find: (project, iid) => host.issues.find((i) => i.project === project && i.iid === iid),
  };

  const read = (endpoint: string): unknown => {
    host.reads.push(endpoint);
    const one = /^projects\/([^/]+)\/issues\/(\d+)$/.exec(endpoint);
    if (one) {
      const found = host.find(decodeURIComponent(one[1]), Number(one[2]));
      if (!found) throw new VcsError('not_found', { what: endpoint });
      return row(found);
    }
    const list = /^projects\/([^/]+)\/issues\?(.*)$/.exec(endpoint);
    if (list) {
      const project = decodeURIComponent(list[1]);
      const query = new URLSearchParams(list[2]);
      if (project.includes('broken')) throw new VcsError('server', { detail: 'boom' }, { status: 500 });
      const mine = query.get('scope') === 'assigned_to_me';
      const page = Number(query.get('page') ?? 1);
      const per = Number(query.get('per_page') ?? 100);
      const rows = host.issues
        .filter((i) => i.project === project && i.state === 'opened' && (!mine || i.mine))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(row);
      return rows.slice((page - 1) * per, page * per);
    }
    return [];
  };

  const write = async (c: VcsCommand, meta?: { code?: number; response?: unknown }): Promise<string> => {
    host.commands.push(c);
    if (host.failNext) {
      const message = host.failNext;
      host.failNext = null;
      throw new Error(message);
    }
    const create = /^projects\/([^/]+)\/issues$/.exec(c.endpoint);
    if (c.method === 'POST' && create) {
      const project = decodeURIComponent(create[1]);
      const iid = Math.max(100, ...host.issues.filter((i) => i.project === project).map((i) => i.iid)) + 1;
      host.add(project, iid, { title: c.fields.title, description: c.fields.description, labels: c.fields.labels ? c.fields.labels.split(',') : [] });
      if (meta) {
        meta.code = 201;
        meta.response = host.noNumber ? { web_url: urlOf(project, iid) } : { iid, web_url: urlOf(project, iid) };
      }
      return 'created';
    }
    const issue = /^projects\/([^/]+)\/issues\/(\d+)(\/notes)?$/.exec(c.endpoint);
    const found = issue ? host.find(decodeURIComponent(issue[1]), Number(issue[2])) : undefined;
    if (issue && found) {
      if (issue[3]) found.comments.push(c.fields.body);
      else {
        if (c.fields.add_labels) found.labels = [...found.labels, ...c.fields.add_labels.split(',')];
        if (c.fields.remove_labels) {
          const drop = c.fields.remove_labels.split(',').map((l) => l.toLowerCase());
          found.labels = found.labels.filter((l) => !drop.includes(l.toLowerCase()));
        }
        if (c.fields.state_event === 'close') found.state = 'closed';
        if (c.fields.state_event === 'reopen') found.state = 'opened';
      }
      if (meta) meta.code = 200;
    }
    return 'ok';
  };

  host.runtime = fakeGitlabRuntime(async (endpoint) => read(endpoint), undefined, async (command, meta) => write(command, meta));
  return host;
}
