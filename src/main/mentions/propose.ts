import { createHash } from 'node:crypto';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { proposeVcsCommands, runVcsAuto } from '../actions';
import { issueProjectKey, rc } from '../workspaceConfig';
import { vcsProvider } from '../vcs';
import { VcsError } from '../vcs/errors';
import type { VcsCommand, VcsWriteOp } from '../vcs/types';
import type { MentionPlace } from './place';
import type { ProposedWrite } from './call';

// What a mention answer may propose on the code host, wherever it answers (a run's thread, a channel, a general conversation, the direct conversation of an agent): the
// same door every write of the app goes through, reached directly (no publisher). A proposed write is planned by the provider (`planWrite`), validated by the door, and
// either waits in Actions for the person's yes or, when the agent's autonomy lets a low-risk write (a comment, a label) go out, runs audited through `runVcsAuto`. A
// write whose planning returns several commands (a label change on a host that removes one by one) is one proposal holding every command, so nothing it asked for is
// dropped. Closing an issue, changing its status and opening one always wait for the person. The provider that says it does not have the operation (issue labels on
// Bitbucket, a status a host refuses) raises `unsupported`, which becomes a line in the thread.

/** What one proposed write became: it waits in Actions (one proposal per command when the host planned several), it ran by itself, or the host does not have it. */
export type ProposalOutcome =
  | { status: 'proposed' | 'auto'; key: string; count: number }
  | { status: 'unsupported'; op: ProposedWrite['op']; reason: string }
  | { status: 'failed'; op: ProposedWrite['op']; reason: string };

/** The write operations an agent's autonomy may let out by itself: a comment and a label change. Everything else waits for the person. */
const LOW_RISK: ReadonlySet<ProposedWrite['op']> = new Set(['comment', 'labels']);

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** The operation of a proposed write, as the provider's `VcsWriteOp`. */
function opOf(w: ProposedWrite, project: string): VcsWriteOp {
  switch (w.op) {
    case 'comment':
      return { op: 'commentIssue', project, iid: w.issue, body: w.body };
    case 'labels':
      return { op: 'setIssueLabels', project, iid: w.issue, add: w.add, remove: w.remove };
    case 'status':
      return { op: 'setIssueStatus', project, iid: w.issue, status: w.status };
    case 'close':
      return { op: 'closeIssue', project, iid: w.issue };
    case 'createIssue':
      return { op: 'createIssue', project, title: w.title, body: w.body, labels: w.labels };
  }
}

/** The body a write carries, for the hash the audit log keeps and the text the person reads. */
const bodyOf = (w: ProposedWrite): string => (w.op === 'labels' ? `${w.add.join(',')}|${w.remove.join(',')}` : w.op === 'status' ? w.status : w.op === 'close' ? w.body : w.op === 'comment' ? w.body : `${w.title}\n${w.body}`);

/** What the person reads: the write in two words and what it will put on the host. */
function summaryOf(w: ProposedWrite, place: MentionPlace): string {
  const where = place.ref ?? '';
  switch (w.op) {
    case 'comment':
      return `${where} — a comment`;
    case 'labels':
      return `${where} — labels ${[...w.add.map((l) => `+${l}`), ...w.remove.map((l) => `-${l}`)].join(' ')}`;
    case 'status':
      return `${where} — status ${w.status}`;
    case 'close':
      return `${where} — close`;
    case 'createIssue':
      return `a new issue: ${w.title}`;
  }
}

/** The issue number out of a place reference (`app#101`), 0 when it names none: what a place names, not the registration target of a proposal. */
export function iidOfRef(ref: string | undefined): number {
  const m = ref ? /#(\d+)$/.exec(ref) : null;
  return m ? Number(m[1]) : 0;
}

/**
 * The issue a write of an answer is registered under: the issue the place names (a run's thread, a conversation about one issue), else the workspace's issue
 * project, which every write of the app registers under. A place that names no issue and a workspace whose project has no number yet still get a number, so the
 * registration and the audit line never carry the 0 that reads as "no issue".
 */
export function iidForRegistration(ref: string | undefined): number {
  const named = iidOfRef(ref);
  if (named) return named;
  try {
    return Number(rc().issues.projectId) || 0;
  } catch {
    return 0;
  }
}

/**
 * The writes an answer raised, one by one: each becomes one proposal per command the host planned (a label change on GitHub is several calls, and none of them may be
 * dropped). Each is planned with the provider of the workspace's issues and proposed under the same door the app writes through: an autonomous agent lets a comment and a
 * label change go out (audited), everything else waits in Actions. A host that does not have the operation, and a workspace that refuses external writes (a test
 * workspace), are said as such, and nothing is written.
 */
export async function proposeMention(e: { writes: ProposedWrite[]; place: MentionPlace; agent: AgentDef; autonomous: boolean; config: WorkspaceConfig; issue: number; seq: number; runId?: string | null }): Promise<ProposalOutcome[]> {
  const out: ProposalOutcome[] = [];
  if (!e.writes.length) return out;
  let project = '';
  try {
    project = issueProjectKey();
  } catch {
    // A workspace with no issue project has nowhere to propose: nothing is proposed.
    return out;
  }
  let provider: ReturnType<typeof vcsProvider>;
  try {
    provider = vcsProvider();
  } catch {
    return out;
  }
  for (const [i, w] of e.writes.entries()) {
    const body = bodyOf(w);
    // The response, the owner and the agent make one answer's proposals distinct; the write's index and the hash keep two equal writes of the same answer apart, and
    // proposes from another answer never collide with these.
    const key = `mention:${e.place.thread}:${e.place.owner ?? e.agent.id}:${e.agent.id}:${e.seq}:${i}:${hashOf(body)}`;
    // The issue the write is registered under: the run's issue when the answer was given in a run's thread, else the workspace's own issue project. Never the 0 of
    // a place that names no issue, which would leave the Actions registration and the audit line without an issue to point at.
    const target = e.issue || iidForRegistration(e.place.ref);
    let commands: VcsCommand[];
    try {
      commands = await provider.planWrite(opOf(w, project));
    } catch (err) {
      if (err instanceof VcsError && err.code === 'unsupported') out.push({ status: 'unsupported', op: w.op, reason: err.message });
      else out.push({ status: 'failed', op: w.op, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!commands.length) continue;
    const summary = summaryOf(w, e.place);
    // The autonomy of the agent lets only a low-risk write out by itself; the door refuses it in a test workspace, and it is said as a failure.
    if (e.autonomous && LOW_RISK.has(w.op)) {
      try {
        for (const [n, command] of commands.entries()) await runVcsAuto({ issue: target, key: commands.length > 1 ? `${key}#${n + 1}` : key, summary, by: e.agent.id, bodyHash: hashOf(body) }, command);
        out.push({ status: 'auto', key, count: commands.length });
      } catch (err) {
        out.push({ status: 'failed', op: w.op, reason: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }
    // One proposal for the whole write: the first command keeps the key and the rest get a suffix, so a host that plans several is proposed whole.
    proposeVcsCommands(
      {
        key,
        issue: target,
        issueTitle: e.place.title ?? '',
        summary,
        detail: w.op === 'createIssue' || w.op === 'comment' || w.op === 'close' ? body : undefined,
        // `runId` names the run of a run's thread, so the runner keeps telling the thread what became of the proposal it made; a place that is not a run leaves it out.
        unit: { purpose: 'mention-write', thread: e.place.thread, agent: e.agent.id, op: w.op, n: i, seq: e.seq, batch: `${e.place.thread}:${e.seq}`, ...(e.runId ? { runId: e.runId } : {}) },
        notify: { title: summary, body: e.place.title ?? '' },
      },
      commands,
    );
    out.push({ status: 'proposed', key, count: commands.length });
  }
  return out;
}
