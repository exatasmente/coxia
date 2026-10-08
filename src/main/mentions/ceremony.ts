import type { AgentDef } from '../../shared/config/types';
import { MAX_MENTIONS, mentionableIds, parseMentions, type Author, type ForumMessage } from '../../shared/forum';
import { t } from '../../shared/i18n';
import { partialHint } from '../../shared/partial';
import { runAgent } from '../agents';
import { text as cycleWord } from '../cyclePrompts';
import { getConfig } from '../workspaceConfig';
import { mentionCall } from './call';

// The agents a person names inside a ceremony: the daily call, the deep dive, the re-entry, the QA handoff, the retro and the free answer of a gate take a typed
// question. Only the ceremony's system agent answered there; now a `@agent` makes that agent of the team answer inside the ceremony too. It answers read only, with
// the card or issue under discussion as its context, and it is recorded under its own name; the system agent keeps leading the ceremony and takes over afterwards.

/** One answer a ceremony's named agent gave: who, what it wrote and the line that is spoken for it. */
export interface CeremonyMention {
  agent: string;
  name: string;
  text: string;
  speech: string;
}

/** What a ceremony hands the mentions: the thread it is read in, the card/issue under discussion, and the messages so far. */
export interface CeremonyContext {
  thread: string;
  ref: string;
  title: string;
  msgs: { who: string; text: string }[];
}

/** The name an agent is shown by: the catalog key or literal of `AgentDef.name`, in the workspace language. */
const nameOf = (agent: AgentDef): string => cycleWord(agent.name);

/** The ceremony's messages as a thread a mention call can read: the person's own, and the agents'. */
function asThread(msgs: { who: string; text: string }[]): ForumMessage[] {
  return msgs.map((m, i) => {
    const author: Author = m.who === 'me' ? { type: 'person' } : m.who === 'app' ? { type: 'app' } : { type: 'agent', id: m.who };
    return { v: 1, type: 'message', seq: i + 1, thread: '', at: '', kind: 'post', author, text: m.text, code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null, replyTo: null, public: false, waitsForAnswer: false, published: null };
  });
}

/**
 * The answers the agents named in a ceremony's text give, in the order named, up to the limit. Nothing is thrown for the caller: a failure becomes an answer with
 * the failure text, so the ceremony goes on. A text with no mention calls nobody (an empty list).
 */
export async function answerCeremonyMentions(text: string, ctx: CeremonyContext): Promise<CeremonyMention[]> {
  const config = getConfig();
  const ids = parseMentions(text, mentionableIds(config.agents.team)).slice(0, MAX_MENTIONS);
  if (!ids.length) return [];
  const thread = asThread(ctx.msgs);
  const message: ForumMessage = { ...asThread([{ who: 'me', text }])[0], thread: ctx.thread };
  const out: CeremonyMention[] = [];
  for (const id of ids) {
    const def = config.agents.team.find((a) => a.id === id);
    if (!def) continue;
    const name = nameOf(def);
    try {
      const call = mentionCall({
        agent: { ...def, permission: 'read' },
        config,
        message,
        thread,
        files: [],
        cwd: config.projects.roots[0] ?? '',
        ref: ctx.ref,
        title: ctx.title,
        place: 'ceremony',
        shell: undefined,
        proposals: false,
      });
      const r = await runAgent<{ text?: unknown }>(call, []);
      const said = typeof (r.data as { text?: unknown })?.text === 'string' ? (r.data as { text: string }).text.trim() : '';
      if (!said) throw new Error(t('main.runner.error.empty-answer'));
      out.push({ agent: id, name, text: r.partial ? `${said}\n\n${partialHint()}` : said, speech: said });
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      out.push({ agent: id, name, text: t('main.mentions.ceremony.failed', { agent: name, reason }), speech: t('main.mentions.ceremony.failed', { agent: name, reason }) });
    }
  }
  return out;
}
