import type { WorkspaceConfig } from '../../src/shared/config/types';
import { type Boot, type BootOptions, type Repo, boot, doc, issue, makeRepo, work } from './runner';
import { withSquads } from './squads';

// A runner on the two-squad workspace: `app` is squad A's repository and `web` is B's, each a clone of its own, and the issues 101 to 103 exist. Every agent of the
// lean flow does its stage at once (what a test changes it by `script`).

export interface SquadBoot {
  b: Boot;
  app: Repo;
  web: Repo;
}

export async function bootSquads(edit: (c: WorkspaceConfig) => void = () => undefined, options: BootOptions = {}): Promise<SquadBoot> {
  const app = makeRepo();
  const web = makeRepo();
  const b = await boot({
    ...options,
    repo: app,
    configure: (c) => {
      c.language = 'en';
      withSquads(c);
      c.projects.repos = [
        { id: 'app', path: app.clone, remoteUrl: null, vcsId: null, projectPath: 'group/project' },
        { id: 'web', path: web.clone, remoteUrl: null, vcsId: null, projectPath: 'group/project' },
      ];
      edit(c);
    },
  });
  for (const iid of [102, 103]) b.issues.add(issue(iid));
  b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] }));
  for (const dev of ['dev-a', 'dev-b']) b.engine.script(dev, () => work(`Built by ${dev}.`, { artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('sec-b', () => work('Safe.', { artifacts: [doc('4_SECURITY.md')], verdict: 'approved', findings: [] }));
  return { b, app, web };
}

/** What a liaison answers to a question it holds: a request to another squad. */
export const requesting = (squad: string, kind: 'question' | 'change', text: string) => () => ({ verdict: 'request', text: '', reason: '', request: { squad, kind, text } });
/** What a liaison answers to a request it receives. */
export const receiving = (answer: Record<string, unknown>) => () => ({ text: '', reason: '', title: '', ...answer });
/** A stage whose agent cannot go on without an answer. */
export const asking = (text: string) => () => work('Stuck.', { question: text });
