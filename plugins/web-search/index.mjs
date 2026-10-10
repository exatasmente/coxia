import { documentOf, section } from './lib/document.mjs';
import { newQuestions } from './lib/requests.mjs';

// The web search for the agents. When a stage ends, the questions an agent wrote in SEARCH_REQUESTS.md are searched on the SearXNG instance the person
// set, through the app (the plugin never reaches the network itself), and the answers are added to WEB_SEARCH.md, which the next stage reads.
// All the searches of a stage are asked together, so they go in one round (see the kit: requests work by replay).

/** The most new questions searched per stage. */
export const QUESTIONS_PER_STAGE = 5;

/** @param {import('../../docs/plugins/kit/coxia-plugin').PluginContext} ctx */
export default async function webSearch(ctx) {
  // A call from a conversation: one question per call, searched at once. What is returned goes back to that conversation, and in a conversation of a
  // run it is also written over the document the stages kept, with its history (there is no document where there is no run).
  if (ctx.event === 'conversation-called') {
    const question = String(ctx.asked ?? '').trim();
    if (!question) return {};
    const before = await ctx.readCycleFile('WEB_SEARCH.md');
    const answer = await ctx.request('search', { query: { q: question, format: 'json' } }).catch((e) => ({ refused: e instanceof Error ? e.message : String(e) }));
    return { document: documentOf(before, [section(question, answer)]) };
  }
  const before = await ctx.readCycleFile('WEB_SEARCH.md');
  const questions = newQuestions(await ctx.readCycleFile('SEARCH_REQUESTS.md'), before, QUESTIONS_PER_STAGE);
  if (!questions.length) return {};
  const answers = await Promise.all(questions.map((q) => ctx.request('search', { query: { q, format: 'json' } }).catch((e) => ({ refused: e instanceof Error ? e.message : String(e) }))));
  return { document: documentOf(before, questions.map((q, i) => section(q, answers[i]))) };
}
