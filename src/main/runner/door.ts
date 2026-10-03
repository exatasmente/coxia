import { onActionDone, proposeRunPush, proposeVcsGroup, runVcsAuto } from '../actions';
import { vcsProvider } from '../vcs';
import { externalRefusal } from '../workspace';
import { t } from '../../shared/i18n';
import type { Door } from './publish';

// The runner's one way out to the code host. It is the only file of the runner that imports Actions: everything that leaves the machine from a run goes
// through the same proposals, the same refusal in a test workspace and the same audit log as what a person starts by hand.

export const realDoor: Door = {
  provider() {
    try {
      return vcsProvider();
    } catch {
      return null;
    }
  },
  refusal: () => externalRefusal(t('vcs.write.guard')),
  async post(meta, commands) {
    const responses: unknown[] = [];
    for (const [i, command] of commands.entries()) responses.push(await runVcsAuto({ ...meta, key: commands.length > 1 ? `${meta.key}#${i + 1}` : meta.key }, command));
    return responses;
  },
  propose: (meta, commands) => proposeVcsGroup({ key: meta.key, issue: meta.issue, issueTitle: meta.issueTitle, summary: meta.summary, detail: meta.detail, unit: meta.unit, notify: meta.notify }, commands) !== null,
  proposePush: (meta) => proposeRunPush({ key: meta.key, issue: meta.issue, issueTitle: meta.issueTitle, summary: meta.summary, runId: meta.runId, branch: meta.branch, notify: meta.notify }) !== null,
};

/** Tells `fn` when a proposal of the runner (a comment, a review, the push, the pull request) was carried out. */
export const onRunnerActionDone = onActionDone;
