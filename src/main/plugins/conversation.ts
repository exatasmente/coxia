import { conversationCommand, type ConversationCommand } from '../../shared/plugins/calls';
import type { ForumMessage } from '../../shared/forum';
import type { Module } from '../module';
import { forumStore } from '../forum';
import { runStore } from '../runs';
import { callPluginFromConversation } from './module';

// A message of a conversation calling a plugin (`/web-search how does replay work?`): the caller here is the only one that reads the command, and the
// answer of the plugin comes back to the same conversation as material (the service delivers it). One call at a time per conversation, so the thread
// reads in order, and nothing of this can become a loop: a message with a mention of an agent is that agent's to answer (a call between agents carries
// one), and a line the app words is never a post (see calls.ts for what a command is).
let queue: Map<string, Promise<void>> | null = null;

/** The chains of the running workspace: one promise per conversation, so a call never overtakes another in the same conversation. */
const inFlight = (): Map<string, Promise<void>> => (queue ??= new Map());

/** The plugin call a message of the forum is, or null: a post that names no agent, written by anyone but the app, with a command and a question in it. */
export function pluginCallOf(message: ForumMessage): ConversationCommand | null {
  if (message.kind !== 'post' || message.author.type === 'app') return null;
  if (message.mentions.length) return null;
  return conversationCommand(message.text ?? '');
}

export const pluginsConversationModule: Module = () => {
  const forum = forumStore();
  forum.subscribe((message) => {
    const call = pluginCallOf(message);
    if (!call) return;
    const thread = message.thread;
    // A conversation of a run carries that run to the plugin (and its document goes into the cycle folder); any other one carries none.
    const run = thread.startsWith('run-') ? runStore().get(thread.slice(4)) : null;
    const ask = {
      command: call.command,
      asked: call.asked,
      thread,
      issue: run ? run.issue.iid : 0,
      ...(run ? { issueTitle: run.issue.title, stage: run.stage, runId: run.id } : {}),
    };
    const prior = inFlight().get(thread);
    const next = (prior ?? Promise.resolve())
      .then(() => callPluginFromConversation(ask))
      .then(() => undefined)
      // Whatever ended the call early, the conversation goes on and the next call of it is not held up by this one.
      .catch(() => undefined);
    inFlight().set(thread, next);
    void next.finally(() => {
      if (inFlight().get(thread) === next) inFlight().delete(thread);
    });
  });
};

/** Waits for the calls the module started (a test, or a caller that wants the conversations settled). */
export async function pluginCallsIdle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const all = [...inFlight().values()];
    if (!all.length) return;
    await Promise.allSettled(all);
  }
}