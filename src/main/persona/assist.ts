import { ASSIST_LIMITS, ASSIST_ROUND_SCHEMA, readAssistDraft, type AssistDraft } from '../../shared/agentAssist';
import { agentThreadId } from '../../shared/forum';
import { addAgent, isDraft, isPersona, personaDraftOf, personaOf, removeAgent, uniqueId, updateAgent } from '../../shared/config/team';
import { LLM_ROLES, POOL_MODES, type AgentDef, type AgentModel, type PoolMode, type WorkspaceConfig } from '../../shared/config/types';
import { t } from '../../shared/i18n';
import { PERSONA_REVIEW_SCHEMA, personaAccessPatch, readPersonaReview, type PersonaReview } from '../../shared/persona';
import { draftIdFor, draftOfAgent, readAssistInput, readRoundAnswer, testConversation, type AssistInput, type RoundAnswer } from '../agentAssist-core';
import { AssistError, endScreensOn, explain } from '../agentAssist';
import { askBare } from '../agents';
import { attachmentStore } from '../attachments';
import { recordWrite } from '../auditoria';
import { refusedPaths } from '../configScope';
import { redact } from '../errorlog-core';
import { forumStore } from '../forum';
import { deleteAgentThread, ensureAgentThread } from '../forum-channels';
import { memoryStore } from '../memory/instance';
import { answerPending } from '../mentions/module';
import { callStops } from '../mentions/stop';
import { callOrigin } from '../rpc';
import { getConfig, updateConfig } from '../workspaceConfig';
import { personaDraftAgent, personaReviewPrompt, personaRoundPrompt, personaSystem, type PersonaPromptInput } from './assistCore';

// The wizard that makes the persona, and the editor's writes, in the main process (#247). It is the creator's machinery with its own questions: the model is the `deep` role's,
// asked with no tool, and decides nothing but the questions and three texts. Every channel is open to a paired browser (webPolicy.ts), so the entry is built here from the texts
// alone: the screen sends no setting, and what the persona starts with is the app's (personaAccess). The state of the wizard is the screen's; here nothing is kept between two
// calls but the draft persona itself, an ordinary entry of the team marked as a draft and as a persona, inert by construction.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const stringOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Whatever went wrong outside the model, as text a person can act on: an error already worded passes, any other is said with its reason redacted and cut. */
function fail(e: unknown): Error {
  if (e instanceof AssistError) return e;
  return new AssistError(t('main.persona.error.failed', { reason: redact(e instanceof Error ? e.message : String(e)).slice(0, 300) }));
}

/** Which door the call came through, for the audit. */
const through = (): 'window' | 'paired' => (callOrigin() === 'web' ? 'paired' : 'window');

/** Every change of the persona is recorded with the door it came by and the agent's id; never a text. */
function audit(op: 'draft' | 'conclude' | 'discard' | 'finish' | 'save' | 'clear' | 'delete', agent: string): void {
  recordWrite({
    kind: 'persona',
    issue: 0,
    target: `persona:${op}`,
    via: through(),
    fields: { agent },
    ok: true,
    code: null,
    result: op,
    origin: { actionId: '', kind: 'persona', key: agent, summary: null },
  });
}

// ---- the two questions --------------------------------------------------------------------------------------------------------------------------

interface Prepared {
  input: AssistInput;
  prompt: PersonaPromptInput;
  /** The draft the model's texts fall back to: the one the screen holds, or the persona's own when adjusting. */
  previous: AssistDraft;
}

/** Reads what the screen sent and builds what both questions are made of. Refuses before any model is asked. */
function prepare(raw: unknown): Prepared {
  const input = readAssistInput(raw);
  if (!input.request) throw new AssistError(t('main.persona.error.noRequest'));
  if (input.rounds.length > ASSIST_LIMITS.rounds) throw new AssistError(t('main.assist.error.rounds', { max: ASSIST_LIMITS.rounds }));
  const config = getConfig();
  const persona = personaOf(config.agents.team);
  let original: AssistDraft | null = null;
  if (input.mode === 'adjust') {
    if (!persona || persona.id !== input.from) throw new AssistError(t('main.persona.error.original'));
    const stored = draftOfAgent(persona);
    const sent = input.form?.draft;
    original = { name: sent?.name || stored.name, job: sent?.job || stored.job, instructions: sent?.instructions || stored.instructions };
  } else if (persona) {
    throw new AssistError(t('main.persona.error.exists'));
  }
  const testing = input.testId && config.agents.team.some((a) => a.id === input.testId && isPersona(a) && isDraft(a));
  const conversation = testing ? testConversation(forumStore().read(agentThreadId(input.testId as string), 0, 2000)?.messages ?? []) : '';
  return {
    input,
    previous: input.draft.name || input.draft.job || input.draft.instructions ? input.draft : (original ?? input.draft),
    prompt: { mode: input.mode, request: input.request, rounds: input.rounds, draft: input.draft, original, test: conversation, note: input.note },
  };
}

/** The next round of questions and the refined draft. The fifth round does not exist. */
export async function personaRound(raw: unknown): Promise<RoundAnswer> {
  try {
    const p = prepare(raw);
    if (p.input.rounds.length >= ASSIST_LIMITS.rounds) throw new AssistError(t('main.assist.error.rounds', { max: ASSIST_LIMITS.rounds }));
    const run = await askBare<unknown>('deep', personaRoundPrompt(p.prompt), ASSIST_ROUND_SCHEMA, { system: personaSystem() });
    const round = readRoundAnswer(run.data, p.previous);
    if (!round) throw new AssistError(t('main.assist.error.empty'));
    return round;
  } catch (e) {
    throw explain(e);
  }
}

/** The finished draft: the three texts and nothing else. */
export async function personaReview(raw: unknown): Promise<PersonaReview> {
  try {
    const p = prepare(raw);
    const run = await askBare<unknown>('deep', personaReviewPrompt(p.prompt), PERSONA_REVIEW_SCHEMA, { system: personaSystem() });
    const review = readPersonaReview(run.data, p.previous, redact);
    if (!review) throw new AssistError(t('main.assist.error.empty'));
    return review;
  } catch (e) {
    throw explain(e);
  }
}

// ---- the draft persona --------------------------------------------------------------------------------------------------------------------------

/** The persona draft with this id. Anything else (an agent of the person, a system agent, the persona itself, no id at all) is refused: this is the door that keeps an agent safe from "discard". */
function draftOf(config: WorkspaceConfig, id: string | null): AgentDef {
  const found = id ? config.agents.team.find((a) => a.id === id) : undefined;
  if (!found || !isPersona(found) || !isDraft(found) || found.system) throw new AssistError(t('main.persona.error.notDraft', { id: (id ?? '').slice(0, 48) }));
  return found;
}

/** The persona of the workspace, or the refusal that says there is none. */
function personaNow(config: WorkspaceConfig): AgentDef {
  const found = personaOf(config.agents.team);
  if (!found) throw new AssistError(t('main.persona.error.none'));
  return found;
}

/**
 * Saves the persona a person tries out in a conversation, or updates the draft saved before, and makes its direct conversation. The main builds it from the texts alone: it
 * comes out inert (no stage, no squad, not autonomous, turning to the person) with the starting access of the app, whatever was sent. Updating starts the conversation over:
 * its answers belong to instructions that are gone. Adjusting (`from`, the persona's id) saves a copy that keeps the persona's model; making one is refused when the
 * workspace has a persona. A draft already in the team is reused, never a second.
 */
export function personaSaveDraft(raw: unknown): { id: string } {
  try {
    const body = isRecord(raw) ? raw : {};
    const config = getConfig();
    const from = stringOf(body.from);
    const persona = personaOf(config.agents.team);
    if (from ? persona?.id !== from : persona) throw new AssistError(t(from ? 'main.persona.error.original' : 'main.persona.error.exists'));
    const given = readAssistDraft(body.draft, undefined, redact);
    const name = given.name || t('main.persona.draftName');
    const forum = forumStore();

    // An id that names an agent that is not the persona's draft is never overwritten.
    const asked = stringOf(body.id);
    const other = asked ? config.agents.team.find((a) => a.id === asked) : undefined;
    if (other && !(isPersona(other) && isDraft(other))) throw new AssistError(t('main.persona.error.notDraft', { id: other.id }));
    const existing = personaDraftOf(config.agents.team);
    // A new id is free of the team, of the ids the app keeps, and of every direct conversation there is: `agent-<id>` of a draft is always a conversation that begins empty.
    const taken = new Set([...config.agents.team.map((a) => a.id), ...LLM_ROLES, ...forum.list().filter((s) => s.kind === 'agent').map((s) => s.id.slice('agent-'.length))]);
    const id = existing ? existing.id : from ? draftIdFor(name, from, taken) : uniqueId('persona', taken);
    const made = personaDraftAgent(id, name, given, persona);

    updateConfig((current) => {
      const here = current.agents.team.find((a) => a.id === id);
      if (!here) return addAgent(current, made);
      if (!isPersona(here) || !isDraft(here) || here.system) throw new AssistError(t('main.persona.error.notDraft', { id }));
      return updateAgent(current, id, { name: made.name, job: made.job, instructions: made.instructions, model: made.model, ...personaAccessPatch(), draft: true, kind: 'persona' });
    });
    if (existing) deleteAgentThread(forum, attachmentStore(), id, endScreensOn, memoryStore());
    ensureAgentThread(forum, { id, name }, config.language);
    audit('draft', id);
    return { id };
  } catch (e) {
    throw fail(e);
  }
}

/** Concludes the test: the conversation is emptied and begun again, and the draft stays in the team until the wizard finishes. Only a persona draft. */
export function personaConclude(raw: unknown): { id: string } {
  try {
    const config = getConfig();
    const draft = draftOf(config, stringOf(raw));
    const forum = forumStore();
    deleteAgentThread(forum, attachmentStore(), draft.id, endScreensOn, memoryStore());
    ensureAgentThread(forum, { id: draft.id, name: draft.name }, config.language);
    audit('conclude', draft.id);
    return { id: draft.id };
  } catch (e) {
    throw fail(e);
  }
}

/** Discards the draft: the entry leaves the config first (the forum would make its conversation again while it was in the team), then the conversation and its files go. */
export function personaDiscard(raw: unknown): { id: string } {
  try {
    const draft = draftOf(getConfig(), stringOf(raw));
    updateConfig((current) => removeAgent(current, draft.id));
    deleteAgentThread(forumStore(), attachmentStore(), draft.id, endScreensOn, memoryStore());
    audit('discard', draft.id);
    return { id: draft.id };
  } catch (e) {
    throw fail(e);
  }
}

/**
 * Saves and opens the chat. Making (no `from`): the draft stops being one, takes the starting access, and its test conversation is emptied for the chat to begin clean; it is
 * refused when the workspace has a persona. Adjusting (`from`, the persona's id): the draft's three texts go onto the persona, which keeps its model, its access and its
 * conversation, and the copy is removed. Returns the persona's id.
 */
export function personaFinish(raw: unknown): { id: string } {
  try {
    const body = isRecord(raw) ? raw : {};
    const config = getConfig();
    // Finishing without an id finishes the draft there is: the screen holds it, but another device may have made it.
    const draft = draftOf(config, stringOf(body.id) ?? personaDraftOf(config.agents.team)?.id ?? null);
    const from = stringOf(body.from);
    const persona = personaOf(config.agents.team);
    if (from ? persona?.id !== from : persona) throw new AssistError(t(from ? 'main.persona.error.original' : 'main.persona.error.exists'));
    const forum = forumStore();
    if (persona) {
      updateConfig((current) => removeAgent(updateAgent(current, persona.id, { name: draft.name, job: draft.job, instructions: draft.instructions }), draft.id));
      deleteAgentThread(forum, attachmentStore(), draft.id, endScreensOn, memoryStore());
      audit('finish', persona.id);
      return { id: persona.id };
    }
    updateConfig((current) => updateAgent(current, draft.id, { ...personaAccessPatch(), draft: undefined }));
    deleteAgentThread(forum, attachmentStore(), draft.id, endScreensOn, memoryStore());
    ensureAgentThread(forum, { id: draft.id, name: draft.name }, config.language);
    audit('finish', draft.id);
    return { id: draft.id };
  } catch (e) {
    throw fail(e);
  }
}

// ---- the editor ---------------------------------------------------------------------------------------------------------------------------------

// Only the keys of an agent's model are taken, so a body from a paired browser cannot carry anything else into the configuration; the pool lists are checked by the validation.
const MODEL_KEYS = ['role', 'provider', 'model', 'fallbacks', 'activities', 'images', 'contextWindow', 'echoReasoning', 'offer'] as const satisfies readonly (keyof AgentModel)[];

const modelOf = (v: unknown): AgentModel | null => {
  if (!isRecord(v) || typeof v.provider !== 'string' || typeof v.model !== 'string') return null;
  const out: Record<string, unknown> = {};
  for (const k of MODEL_KEYS) if (k in v && v[k] !== undefined) out[k] = structuredClone(v[k]);
  return out as unknown as AgentModel;
};

/**
 * The editor's Save: the three texts, the model and how its pool is used. From a paired browser the change is held to what the browser may change (a reserve model it adds is refused, as on the
 * configuration route); the persona's access is not in the call at all.
 */
export function personaSave(raw: unknown): { id: string } {
  try {
    const body = isRecord(raw) ? raw : {};
    const persona = personaNow(getConfig());
    const texts = readAssistDraft({ name: body.name, job: body.job, instructions: body.instructions }, { name: '', job: '', instructions: '' }, redact);
    if (!texts.name) throw new AssistError(t('main.persona.error.noName'));
    const model = modelOf(body.model);
    // How the persona's own pool is used; saying nothing leaves it, null goes back to inheriting.
    const poolMode = (POOL_MODES as readonly unknown[]).includes(body.poolMode) ? (body.poolMode as PoolMode) : undefined;
    updateConfig((current) => {
      const here = personaNow(current);
      const next = updateAgent(current, here.id, { ...texts, ...(model ? { model } : {}), ...('poolMode' in body ? { poolMode } : {}) });
      const refused = callOrigin() === 'web' ? refusedPaths(current, next) : [];
      if (refused.length) throw new AssistError(t('main.persona.error.refused', { paths: refused.join(', ') }));
      return next;
    });
    audit('save', persona.id);
    return { id: persona.id };
  } catch (e) {
    throw fail(e);
  }
}

/** Whether an answer of the persona is going, or waiting its turn: emptying or deleting under it would cut it. */
const answering = (persona: AgentDef): boolean => answerPending(agentThreadId(persona.id)) || callStops.running(agentThreadId(persona.id)).length > 0;

/** Clear conversation: the thread, its files and its memory folder go, and the persona stays with a conversation that begins empty. Refused while an answer is going. */
export function personaClear(): { id: string } {
  try {
    const config = getConfig();
    const persona = personaNow(config);
    if (answering(persona)) throw new AssistError(t('main.persona.error.busy'));
    const forum = forumStore();
    deleteAgentThread(forum, attachmentStore(), persona.id, endScreensOn, memoryStore());
    ensureAgentThread(forum, persona, config.language);
    audit('clear', persona.id);
    return { id: persona.id };
  } catch (e) {
    throw fail(e);
  }
}

/** Delete: the persona and its test copy leave the config first, then their conversations and files go; the home returns to the invitation. Refused while an answer is going. */
export function personaDelete(): { id: string } {
  try {
    const config = getConfig();
    const persona = personaNow(config);
    if (answering(persona)) throw new AssistError(t('main.persona.error.busy'));
    const copy = personaDraftOf(config.agents.team);
    updateConfig((current) => {
      const without = removeAgent(current, persona.id);
      return copy && without.agents.team.some((a) => a.id === copy.id) ? removeAgent(without, copy.id) : without;
    });
    const forum = forumStore();
    for (const id of [persona.id, ...(copy ? [copy.id] : [])]) deleteAgentThread(forum, attachmentStore(), id, endScreensOn, memoryStore());
    audit('delete', persona.id);
    return { id: persona.id };
  } catch (e) {
    throw fail(e);
  }
}
