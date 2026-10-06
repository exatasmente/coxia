import { documentOf, section } from './lib/document.mjs';
import { newQuestions } from './lib/requests.mjs';

// The web search for the agents. When a stage ends, the questions an agent wrote in SEARCH_REQUESTS.md are searched on the SearXNG instance the person
// set, through the app (the plugin never reaches the network itself), and the answers are added to WEB_SEARCH.md, which the next stage reads.
// All the searches of a stage are asked together, so they go in one round (see the kit: requests work by replay).

/** The most new questions searched per stage. */
export const QUESTIONS_PER_STAGE = 5;

/** @param {import('../../docs/plugins/kit/coxia-plugin').PluginContext} ctx */
export default async function webSearch(ctx) {
  const before = await ctx.readCycleFile('WEB_SEARCH.md');
  const questions = newQuestions(await ctx.readCycleFile('SEARCH_REQUESTS.md'), before, QUESTIONS_PER_STAGE);
  if (!questions.length) return {};
  const answers = await Promise.all(questions.map((q) => ctx.request('search', { query: { q, format: 'json' } }).catch((e) => ({ refused: e instanceof Error ? e.message : String(e) }))));
  return { document: documentOf(before, questions.map((q, i) => section(q, answers[i]))) };
}
