import { describe, expect, it } from 'vitest';
import { STATUS_MUTATION, validateGitlabCommand } from '../src/main/actions';
import type { GitlabCommand } from '../src/shared/types';

const MUTATION =
  'mutation { workItemUpdate(input: { id: "gid://gitlab/WorkItem/123", statusWidget: { status: "gid://gitlab/WorkItems::Statuses::Custom::Status/45" } }) { errors } }';

const graphql = (query: string, over: Partial<GitlabCommand> = {}): GitlabCommand => ({
  via: 'glab',
  method: 'POST',
  endpoint: 'graphql',
  fields: { query },
  ...over,
});

const rest = (endpoint: string, over: Partial<GitlabCommand> = {}): GitlabCommand => ({
  via: 'glab',
  method: 'POST',
  endpoint,
  fields: { body: 'texto' },
  ...over,
});

describe('GraphQL: only the work item status mutation', () => {
  it('accepts the status mutation', () => {
    expect(() => validateGitlabCommand(graphql(MUTATION))).not.toThrow();
    expect(STATUS_MUTATION.test(MUTATION)).toBe(true);
  });

  const refusedQueries: [string, string][] = [
    ['a different mutation', MUTATION.replace('workItemUpdate', 'workItemDelete')],
    ['a mutation on another type', MUTATION.replace('workItemUpdate', 'mergeRequestSetDraft')],
    ['an extra field in the input', MUTATION.replace('statusWidget:', 'title: "x", statusWidget:')],
    ['an extra widget after the status', MUTATION.replace('Status/45" } })', 'Status/45" }, labelsWidget: { addLabelIds: ["gid://gitlab/Label/1"] } })')],
    ['an extra selection', MUTATION.replace('{ errors }', '{ errors workItem { id } }')],
    ['a second operation', `${MUTATION} mutation { workItemDelete(input: { id: "gid://gitlab/WorkItem/1" }) { errors } }`],
    ['an id with a quote injection', MUTATION.replace('WorkItem/123', 'WorkItem/123" } ) { errors } } mutation { x(input: { id: "1')],
    ['a non numeric work item id', MUTATION.replace('WorkItem/123', 'WorkItem/abc')],
    ['a work item id of another type', MUTATION.replace('gid://gitlab/WorkItem/123', 'gid://gitlab/Project/123')],
    ['a status id of another type', MUTATION.replace('Custom::Status/45', 'Custom::Status/45abc')],
    ['a trailing newline and a new operation', `${MUTATION}\nmutation { x }`],
    ['a leading query', `query { currentUser { id } } ${MUTATION}`],
    ['an empty query', ''],
    ['a plain query', 'query { currentUser { id } }'],
  ];
  it.each(refusedQueries)('refuses %s', (_name, query) => {
    expect(() => validateGitlabCommand(graphql(query))).toThrow(/GraphQL só para a mudança de status/);
  });

  it.each(['PUT', 'DELETE'] as const)('refuses method %s', (method) => {
    expect(() => validateGitlabCommand(graphql(MUTATION, { method }))).toThrow(/GraphQL/);
  });

  it('refuses a method that is not in the type (GET)', () => {
    expect(() => validateGitlabCommand(graphql(MUTATION, { method: 'GET' as GitlabCommand['method'] }))).toThrow(/GraphQL/);
  });

  it('refuses the curl path (it would send the token by hand)', () => {
    expect(() => validateGitlabCommand(graphql(MUTATION, { via: 'curl' }))).toThrow(/GraphQL/);
  });

  it('refuses extra fields next to the query', () => {
    expect(() => validateGitlabCommand(graphql(MUTATION, { fields: { query: MUTATION, variables: '{}' } }))).toThrow(/GraphQL/);
  });

  it('refuses a missing query field', () => {
    expect(() => validateGitlabCommand(graphql(MUTATION, { fields: { other: MUTATION } }))).toThrow(/GraphQL/);
    expect(() => validateGitlabCommand(graphql(MUTATION, { fields: {} }))).toThrow(/GraphQL/);
  });
});

describe('REST endpoints', () => {
  const valid = [
    'projects/acme%2Fweb/issues/101/notes',
    'projects/acme%2Fweb/merge_requests/303/notes/12',
    'projects/1/issues/101/notes/9',
    'projects/acme%2Fweb/merge_requests/303?reviewer_ids=1',
    'projects/sz%2Fgateway/merge_requests/303/pipelines',
    'projects/acme%2Fweb/issues/101?labels=QA%3A%3Ax&state_event=close',
  ];
  it.each(valid)('accepts %s', (endpoint) => {
    expect(() => validateGitlabCommand(rest(endpoint))).not.toThrow();
  });

  const invalid = [
    'user',
    'users/1',
    'groups/5',
    'graphql2',
    'projects',
    'projects/1',
    '/projects/1/issues/1/notes',
    'https://evil.example/api/v4/projects/1/issues/1/notes',
    'projects/1/issues/1/notes foo',
    'projects/1/issues/1/notes;rm',
    'projects/1/issues/1/notes\nuser',
    'projects/1/issues/$(id)/notes',
    'projects/1/issues/1/notes#x',
    'projects/1/issues/1/notes@evil.example',
    '',
    'projects/1/../../groups/5',
    'projects/1/%2e%2e/%2e%2e/groups/5',
    'projects/1/%2E%2E/groups/5',
  ];
  it.each(invalid)('refuses %j', (endpoint) => {
    expect(() => validateGitlabCommand(rest(endpoint))).toThrow(/endpoint inválido/);
  });

  it('lets the REST endpoints through any write method and either transport', () => {
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      for (const via of ['glab', 'curl'] as const) {
        expect(() => validateGitlabCommand(rest('projects/1/issues/1/notes', { method, via }))).not.toThrow();
      }
    }
  });
});
