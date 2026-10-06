// i18n-lint: allow-file cycle template data: stage names and file names, whose texts are catalog keys
import { newAgent } from '../../config/team';
import type { AgentDef, CommentTemplate, StageDef } from '../../config/types';
import { sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';

// The documentation of a repository as a flow of its own: the stages of a run that drafts (or brings up to date) the `.coxia/` folder, with a Documentation writer
// agent that may change only that folder. Draft, the person's gate over the draft, then a second stage that writes (it applies what the gate asked and describes
// the pull request: `pushStagesOf` proposes the push at the end of the last stage that writes, so it only exists after the gate), and the wait for the merge.
// The stage ids start with `docs-` so none is the id of a stage of the issue flow. Applying the template puts these stages in `devCycle.flows.docs` and leaves the
// workspace's own flow, for issues, as it is.

export const DOCS_WRITER = 'docs-writer';

/** What the draft stage hands over besides the folder itself: what was imported from Claude Code's files and what was left out, with the reason of each item. */
export const IMPORT_NOTES = 'IMPORT_NOTES.md';

export const DOCS_FLOW_STAGES: StageDef[] = [
  // No stage of this flow comments on the tracker: a documentation run has no issue.
  { id: 'docs-draft', label: 'cycle.docsFlow.stage.draft', match: ['^Draft'], kind: 'development', rank: 1, type: 'work', agentId: DOCS_WRITER, produces: [IMPORT_NOTES], comment: '' },
  { id: 'docs-gate', label: 'cycle.docsFlow.stage.gate', match: ['^Approve the draft$'], kind: 'development', rank: 2, type: 'gate', returnsTo: 'docs-draft' },
  { id: 'docs-publish', label: 'cycle.docsFlow.stage.publish', match: ['^Apply'], kind: 'development', rank: 3, type: 'work', agentId: DOCS_WRITER, comment: '' },
  { id: 'docs-ready', label: 'cycle.docsFlow.stage.ready', match: ['^Ready$'], kind: 'reviewApproved', rank: 4, type: 'wait', waitsFor: { kind: 'pr-merged' } },
  // Where the run ends: nobody works it.
  { id: 'docs-done', label: 'cycle.docsFlow.stage.done', match: ['^Documented$'], kind: 'done', rank: 5, type: 'work', comment: '' },
];

/**
 * The agent of the docs flow: it reads the code and the repository's Claude Code files, writes only inside `.coxia/`, runs no command and reads no tracker. Autonomous:
 * the person's gate over the draft and the "sim" of the push and the pull request are the brakes, and without it the person would accept the result twice.
 */
export function docsWriter(): AgentDef {
  return newAgent({
    id: DOCS_WRITER,
    name: 'cycle.docsFlow.team.docsWriter.name',
    job: 'cycle.docsFlow.team.docsWriter.job',
    instructions: 'cycle.docsFlow.team.docsWriter.instructions',
    stages: DOCS_FLOW_STAGES.filter((s) => s.agentId === DOCS_WRITER).map((s) => s.id),
    permission: 'worktree',
    tracker: 'none',
    shell: 'none',
    autonomous: true,
    turnsTo: null,
    model: { role: 'deep' },
  });
}

const key = (part: string): string => `cycle.docsFlow.comment.docs-pr.${part}`;

/** The description of the pull request of a documentation run: it replaces the issue flow's `pr`, and it has no section that closes an issue. */
export function docsComments(): Record<string, CommentTemplate> {
  return {
    'docs-pr': {
      title: key('title'),
      status: key('status'),
      sections: [1, 2, 3, 4].map((n) => ({ heading: key(`s${n}.heading`), guidance: key(`s${n}.guidance`) })),
      technicalDetail: false,
    },
  };
}

/** The docs flow: the stages of a documentation run and the agent that works them. Applying it adds the flow next to the workspace's own (`runKind: 'docs'`). */
export const docsFlow: CycleTemplate = {
  id: 'docs-flow',
  name: 'cycle.docsFlow.name',
  description: 'cycle.docsFlow.description',
  needs: [],
  runKind: 'docs',
  team: [docsWriter()],
  devCycle: {
    templateId: 'docs-flow',
    stages: DOCS_FLOW_STAGES,
    comments: docsComments(),
    prompts: sameFamily('sdd'),
  },
};
