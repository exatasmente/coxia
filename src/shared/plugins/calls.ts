import { PLUGIN_ID } from './declaration';

// How a message of a conversation calls a plugin: a bar before the plugin's id and the question after it (`/web-search how does replay work?`). Pure and
// without disk or dependencies, so every reader of a message decides the same way: one message is read either as a plugin call or as ordinary text,
// never as both, and `@` keeps naming an agent of the team.

/** What a message asked of a plugin: the plugin's id and the question that follows it. */
export interface ConversationCommand {
  command: string;
  asked: string;
}

/**
 * The plugin call a message is, or null when it is not one: the text trimmed must start with a bar, the name up to the first space must have the shape
 * of a plugin id (a message like `/usr/lib ...` has a bar inside the name and is plain text), and what follows the name must be a non-empty question.
 */
export function conversationCommand(text: string): ConversationCommand | null {
  const body = String(text ?? '').trim();
  if (!body.startsWith('/')) return null;
  const at = body.search(/\s/);
  const head = at < 0 ? body.slice(1) : body.slice(1, at);
  if (!PLUGIN_ID.test(head)) return null;
  const asked = at < 0 ? '' : body.slice(at).trim();
  if (!asked) return null;
  return { command: head, asked };
}