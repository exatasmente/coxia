import { ASSIST_LIMITS, ASSIST_ROUND_SCHEMA, MINIMUM_SETTINGS, assistReviewSchema, clampSettings, readAssistDraft, type AssistDraft, type AssistSettings } from '../shared/agentAssist';
import { agentThreadId } from '../shared/forum';
import { addAgent, isDraft, removeAgent, updateAgent } from '../shared/config/team';
import { LLM_ROLES, type AgentDef, type WorkspaceConfig } from '../shared/config/types';
import { t } from '../shared/i18n';
import {
  adjustable,
  assistContext,
  assistSystem,
  draftAgent,
  draftIdFor,
  draftOfAgent,
  offersOf,
  readAssistInput,
  readReviewAnswer,
  readRoundAnswer,
  reviewPrompt,
  roundPrompt,
  settingsOf,
  testConversation,
  type AssistContext,
  type AssistInput,
  type AssistPromptInput,
  type ReviewAnswer,
  type RoundAnswer,
} from './agentAssist-core';
import { askBare } from './agents';
import { attachmentStore } from './attachments';
import { MaxTurnsError, ProviderBudgetError } from './engine/contract';
import { redact } from './errorlog-core';
import { forumStore } from './forum';
import { deleteAgentThread, ensureAgentThread } from './forum-channels';
import { memoryStore } from './memory/instance';
import type { Module } from './module';
import { screenSessions } from './runner/module';
import { sandbox } from './sandbox/workspace';
import { getConfig, updateConfig } from './workspaceConfig';

// The assistant that creates and adjusts an agent: it asks the model for a round of questions and for the review of the settings (a call with no tool of any kind),
// saves the draft agent a person tests in a conversation, and cleans it up. Every channel is the window's alone (webPolicy.ts). The state of the assistant is the
// screen's; here nothing is kept between two calls but the draft agent itself, which is an ordinary entry of the team marked as a draft, inert by construction.

/** A refusal or a failure already worded for the person: the screen shows its text as it is. */
class AssistError extends Error {}

/** Whatever went wrong, as text a person can act on: the budget of a provider, a model that ran out of steps, or the reason redacted and cut. */
function explain(e: unknown): Error {
  if (e instanceof AssistError) return e;
  // The open engine's detail is its own worded message (it says the app retries by itself, which the assistant does not): only the SDK's is the provider's own text.
  if (e instanceof ProviderBudgetError) return new AssistError(t('main.assist.error.budget', { provider: e.provider, detail: e.engine === 'claude-sdk' ? e.detail.slice(0, 300) : '' }).trim());
  if (e instanceof MaxTurnsError) return new AssistError(t('main.assist.error.turns'));
  return new AssistError(t('main.assist.error.failed', { reason: redact(e instanceof Error ? e.message : String(e)).slice(0, 300) }));
}

/** Whether a sandbox works on this computer: what decides if `shell: sandbox` is offered. A probe that fails is a sandbox that is not there. */
async function hasSandbox(): Promise<boolean> {
  try {
    return (await sandbox.status()).available === true;
  } catch {
    return false;
  }
}

interface Prepared {
  input: AssistInput;
  context: AssistContext;
  prompt: AssistPromptInput;
  /** The draft the model's texts fall back to: the one the screen holds, or the agent's own when adjusting. */
  previous: AssistDraft;
  /** Where the settings start: the minimum, or the agent as the form holds it. */
  base: AssistSettings;
}

/** Reads what the screen sent and builds what both questions are made of. Refuses before any model is asked. */
async function prepare(raw: unknown): Promise<Prepared> {
  const input = readAssistInput(raw);
  if (!input.request) throw new AssistError(t('main.assist.error.noRequest'));
  if (input.rounds.length > ASSIST_LIMITS.rounds) throw new AssistError(t('main.assist.error.rounds', { max: ASSIST_LIMITS.rounds }));
  const config = getConfig();
  const original = input.mode === 'adjust' ? adjustable(config, input.from) : null;
  if (input.mode === 'adjust' && !original) throw new AssistError(t('main.assist.error.original'));
  const context = assistContext(config, await hasSandbox(), original?.id ?? null);
  const offers = offersOf(context);

  // The agent being adjusted, as the form holds it: its texts, and its settings held to the stored agent (a `host` the form shows is kept only if the stored agent has it).
  let form: { draft: AssistDraft; settings: AssistSettings } | null = null;
  if (original) {
    const stored = draftOfAgent(original);
    const sent = input.form?.draft;
    form = {
      draft: { name: sent?.name || stored.name, job: sent?.job || stored.job, instructions: sent?.instructions || stored.instructions },
      settings: clampSettings(input.form?.settings, offers, settingsOf(original), { needReason: false }).settings,
    };
  }
  const conversation = input.testId && config.agents.team.some((a) => a.id === input.testId && isDraft(a)) ? testConversation(forumStore().read(agentThreadId(input.testId), 0, 2000)?.messages ?? []) : '';
  return {
    input,
    context,
    previous: input.draft.name || input.draft.job || input.draft.instructions ? input.draft : (form?.draft ?? input.draft),
    base: form?.settings ?? MINIMUM_SETTINGS,
    prompt: { mode: input.mode, request: input.request, rounds: input.rounds, draft: input.draft, original: form, test: conversation, note: input.note },
  };
}

/** The next round of questions and the refined draft. The fifth round does not exist. */
export async function assistRound(raw: unknown): Promise<RoundAnswer> {
  try {
    const p = await prepare(raw);
    if (p.input.rounds.length >= ASSIST_LIMITS.rounds) throw new AssistError(t('main.assist.error.rounds', { max: ASSIST_LIMITS.rounds }));
    const run = await askBare<unknown>('deep', roundPrompt(p.prompt, p.context), ASSIST_ROUND_SCHEMA, { system: assistSystem() });
    const round = readRoundAnswer(run.data, p.previous);
    if (!round) throw new AssistError(t('main.assist.error.empty'));
    return round;
  } catch (e) {
    throw explain(e);
  }
}

/** The finished draft and the settings, held to what exists, each above the minimum with the model's reason. */
export async function assistReview(raw: unknown): Promise<ReviewAnswer> {
  try {
    const p = await prepare(raw);
    const run = await askBare<unknown>('deep', reviewPrompt(p.prompt, p.context), assistReviewSchema(offersOf(p.context)), { system: assistSystem() });
    const review = readReviewAnswer(run.data, offersOf(p.context), p.base, p.previous);
    if (!review) throw new AssistError(t('main.assist.error.empty'));
    return review;
  } catch (e) {
    throw explain(e);
  }
}

// ---- the draft agent ----------------------------------------------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const stringOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The draft with this id in the stored team. Anything else (an agent of the person, a system agent, an id nobody has) is refused: this is the door that keeps an agent safe from "discard". */
function draftOf(config: WorkspaceConfig, id: string | null): AgentDef {
  const found = id ? config.agents.team.find((a) => a.id === id) : undefined;
  if (!found || !isDraft(found) || found.system) throw new AssistError(t('main.assist.error.notDraft', { id: (id ?? '').slice(0, 48) }));
  return found;
}

/**
 * Saves the agent a person tests, or updates the one saved before, and makes its direct conversation. The main builds it, from the config of now: the screen sends only the
 * texts and the settings, which are held to what exists again, and the agent comes out with no stage, no squad, not autonomous and turning to the person, whatever was
 * sent. Updating starts the conversation over: its answers belong to instructions that are gone. Adjusting an agent (`from`) saves a copy that keeps the stored agent's
 * model and always-allowed commands, read from the stored config and never from the call.
 */
export async function saveAssistDraft(raw: unknown): Promise<{ id: string }> {
  try {
    const body = isRecord(raw) ? raw : {};
    // The sandbox is read before the config is: from here to the write nothing waits, so the config the draft is made against is the one it is written to.
    const sandboxed = await hasSandbox();
    const config = getConfig();
    const from = stringOf(body.from);
    const original = from ? adjustable(config, from) : null;
    if (from && !original) throw new AssistError(t('main.assist.error.original'));
    const given = readAssistDraft(body.draft);
    const settings = clampSettings(body.settings, offersOf(assistContext(config, sandboxed, original?.id ?? null)), original ? settingsOf(original) : MINIMUM_SETTINGS, { needReason: false }).settings;
    const name = given.name || t('main.assist.draftName');
    const forum = forumStore();

    const existing = stringOf(body.id) ? config.agents.team.find((a) => a.id === body.id) : undefined;
    if (existing && (!isDraft(existing) || existing.system)) throw new AssistError(t('main.assist.error.notDraft', { id: existing.id }));
    // A new id is free of the team, of the ids the app keeps, and of every direct conversation there is: `agent-<id>` of a draft is always a conversation that begins empty.
    const taken = new Set([...config.agents.team.map((a) => a.id), ...LLM_ROLES, ...forum.list().filter((s) => s.kind === 'agent').map((s) => s.id.slice('agent-'.length))]);
    const id = existing ? existing.id : draftIdFor(name, original?.id ?? null, taken);
    const made = draftAgent(id, name, given, settings, original);

    updateConfig((current) => {
      const here = current.agents.team.find((a) => a.id === id);
      if (!here) return addAgent(current, made);
      if (!isDraft(here) || here.system) throw new AssistError(t('main.assist.error.notDraft', { id }));
      return updateAgent(current, id, {
        name: made.name,
        job: made.job,
        instructions: made.instructions,
        model: made.model,
        stages: [],
        permission: made.permission,
        tracker: made.tracker,
        shell: made.shell,
        allowedCommands: made.allowedCommands,
        tools: made.tools,
        autonomous: false,
        turnsTo: null,
        squad: undefined,
        draft: true,
      });
    });
    if (existing) deleteAgentThread(forum, attachmentStore(), id, endScreensOn, memoryStore());
    ensureAgentThread(forum, { id, name }, config.language);
    return { id };
  } catch (e) {
    throw explain(e);
  }
}

/** A conversation is being emptied: the screens its agent has open on it end first. */
const endScreensOn = (thread: string): void => void screenSessions()?.closeThread(thread, 'thread').catch(() => undefined);

/** Concludes the assistant: the conversation of the test is emptied and begun again, and the draft stays in the team until the editor saves it. Only a draft. */
export function concludeAssistDraft(raw: unknown): { id: string } {
  try {
    const config = getConfig();
    const draft = draftOf(config, stringOf(raw));
    const forum = forumStore();
    deleteAgentThread(forum, attachmentStore(), draft.id, endScreensOn, memoryStore());
    ensureAgentThread(forum, { id: draft.id, name: draft.name }, config.language);
    return { id: draft.id };
  } catch (e) {
    throw explain(e);
  }
}

/** Discards a draft: the agent leaves the config first (the forum would make its conversation again while it was in the team), then the conversation and its files go. Only a draft. */
export function discardAssistDraft(raw: unknown): { id: string } {
  try {
    const draft = draftOf(getConfig(), stringOf(raw));
    updateConfig((current) => removeAgent(current, draft.id));
    deleteAgentThread(forumStore(), attachmentStore(), draft.id, undefined, memoryStore());
    return { id: draft.id };
  } catch (e) {
    throw explain(e);
  }
}

/** The channels of the assistant. All of them are the window's: they spend the model and make an agent with permissions. */
export const agentAssist: Module = (ctx) => {
  ctx.handle('agentAssist:round', (input: unknown) => assistRound(input));
  ctx.handle('agentAssist:review', (input: unknown) => assistReview(input));
  ctx.handle('agentAssist:saveDraft', (input: unknown) => saveAssistDraft(input));
  ctx.handle('agentAssist:conclude', (id: unknown) => concludeAssistDraft(id));
  ctx.handle('agentAssist:discard', (id: unknown) => discardAssistDraft(id));
};
