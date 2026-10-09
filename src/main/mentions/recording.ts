import type { AttachmentRef } from '../../shared/attachments';
import { t } from '../../shared/i18n';
import type { AttachmentStore } from '../attachments';
import { type NotKept, notKeptText } from '../evidence/recording';
import type { ForumStore } from '../forum-core';
import type { RecordingOutcome } from '../screen/recorder';

// The recording of an agent's screen in a conversation (#177, rules 18 to 20): when the screen closes, the app keeps the video in the conversation's folder of attachments, as the
// app's own `video` attachment, and says so in the conversation with one post of its own (a system post: it is no part of any prompt). A recording that cannot be kept is said, with
// the reason, and never fails the answer that was working when the screen closed.

export interface ConversationRecordingDeps {
  store: Pick<AttachmentStore, 'putVideo' | 'drop'>;
  forum: Pick<ForumStore, 'append' | 'summary'>;
  /** The anchor that makes the post openable as the conversation's own (`threadAnchor`). */
  anchor: (thread: string) => string;
  now?: () => Date;
}

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** The conversation says the recording was not kept, and why. The screen's end never waits for this to succeed. */
function notKept(d: ConversationRecordingDeps, thread: string, agent: string, why: NotKept): void {
  try {
    d.forum.append(thread, { kind: 'system', author: { type: 'app' }, code: 'runner.screen.notKept', params: { agent, reason: notKeptText(why) } });
  } catch (e) {
    console.error('[mentions] could not say a recording was not kept', e instanceof Error ? e.message : e);
  }
}

/**
 * Keeps the recording of a conversation's screen. `kept` when the video is in the conversation and the post says so; `not` otherwise (no recording, a recording that failed, a
 * file the store refused). The post carries the agent and the stretch of the day the video covers, and says so when the video keeps a hand-off (#178).
 */
export function keepConversationRecording(d: ConversationRecordingDeps, screen: { thread: string; agent: string }, outcome: RecordingOutcome | null): 'kept' | 'not' {
  // A screen that was never recorded (no viewer) has nothing to keep and nothing to say.
  if (!outcome) return 'not';
  const { thread, agent } = screen;
  // The conversation went away (it was deleted, and that is why the screen ended): there is nowhere to keep it.
  if (!d.forum.summary(thread)) return 'not';
  if (!outcome.ok) {
    notKept(d, thread, agent, outcome.reason);
    return 'not';
  }
  let ref: AttachmentRef;
  try {
    const put = d.store.putVideo(thread, t('main.attachment.kind.video'), outcome.bytes);
    if (!put.ok) {
      notKept(d, thread, agent, put.problem);
      return 'not';
    }
    ref = put.ref;
  } catch (e) {
    console.error('[mentions] could not keep a recording', e instanceof Error ? e.message : e);
    notKept(d, thread, agent, 'write');
    return 'not';
  }
  const to = d.now?.() ?? new Date();
  const from = new Date(to.getTime() - (outcome.meta.realMs ?? outcome.meta.durationMs));
  try {
    d.forum.append(thread, { kind: 'system', author: { type: 'app' }, code: outcome.meta.handoff ? 'runner.screen.recordingHandoff' : 'runner.screen.recording', params: { agent, from: hhmm(from), to: hhmm(to) }, attachments: [ref], anchor: d.anchor(thread) });
    return 'kept';
  } catch (e) {
    console.error('[mentions] could not post a recording', e instanceof Error ? e.message : e);
    // The file with no post that names it is nobody's: it goes.
    d.store.drop(thread, ref.id);
    return 'not';
  }
}
