import { t } from '../../shared/i18n';
import type { Json } from '../engine/open/types';
import { type ToolImpl, ToolError } from '../engine/open/tools/types';
import { CALL_AGENT_TOOL } from '../runner/tools';

// `CallAgent` for an agent that answers in a conversation (its direct conversation, a squad channel, the general conversation, a run's thread): it asks another
// agent of the team about a point, the other answers in the same conversation, read only, as if named there, and the answer comes back to the caller, who goes
// on with its own. So a product owner talking with the person can bring in the tech lead or support, and a developer the tech lead. A call back to an agent
// already in the exchange is refused, and one answer makes at most `cap` calls, so agents calling each other always end.

export interface ConversationCall {
  /** The ids of the team: who may be called. */
  team: readonly string[];
  /** The agents already in the exchange that led here, the caller last: a call to one of them is refused. */
  chain: readonly string[];
  /** The calls one answer may make. */
  cap: number;
  /** Asks `to` about `topic` in the conversation; the text it answered, or null when it could not answer (the conversation says why). */
  ask(to: string, topic: string): Promise<string | null>;
}

export function conversationCallTool(o: ConversationCall): ToolImpl {
  let made = 0;
  return {
    name: CALL_AGENT_TOOL,
    // i18n-ignore: prompt and tool texts the engines send the model: English by design
    description:
      'Asks another agent of the team about a point, in this conversation: they answer here, where the person sees it, and you get their answer back to go on with yours. Use it when what you were asked depends on what they know or decide (the tech lead on a technical point, support on what customers report, the developer on how something works). Call again to follow up.',
    parameters: {
      type: 'object',
      properties: {
        // i18n-ignore-start: prompt and tool texts the engines send the model: English by design
        to: { type: 'string', description: 'The id of the agent of the team to ask.' },
        topic: { type: 'string', description: 'What you ask them, with what they need to answer.' },
        // i18n-ignore-end
      },
      required: ['to', 'topic'],
      additionalProperties: false,
    } as unknown as Json,
    async run(input) {
      const to = String(input.to ?? '').trim();
      const topic = String(input.topic ?? '').trim();
      if (!topic) throw new ToolError(t('main.runner.tools.emptyTopic'));
      if (!o.team.includes(to)) throw new ToolError(t('main.runner.tools.unknownAgent', { to: to || '—', list: o.team.join(', ') }));
      if (o.chain.includes(to)) return { response: t('main.mentions.call.refusedCycle', { called: to }), render: String };
      if (made >= o.cap) return { response: t('main.mentions.call.refusedCap', { cap: o.cap }), render: String };
      made++;
      const answer = await o.ask(to, topic);
      return { response: answer ? t('main.mentions.call.answered', { called: to, text: answer }) : t('main.mentions.call.noAnswer', { called: to }), render: String };
    },
  };
}
