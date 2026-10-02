import { baseParams, prompt } from './cyclePrompts';

// The agents are told how the conversation reaches the person. With voice on it is spoken, so the "fala" field is written to be heard; with
// voice off nobody hears it, and "fala" is the short message the screen shows. The output schemas do not change.
//
// The wording itself lives in the prompt catalogs (src/shared/i18n: the plain key for voice, the same key plus ".novoice" for text) and the
// prompts take it as placeholders ({mode}, {heard}, {call}, {answered}, {speechRules}, {chatRules}). These functions read the same words for
// the code that wants one of them on its own.

const param = (name: string): string => String(baseParams()[name]);

/** Style rules for what the person reads or hears. */
export const speechRules = (): string => param('speechRules');
/** What "texto" and "fala" are when an answer has both. */
export const chatRules = (): string => param('chatRules');
/** The preamble of every agent (a workspace may override it). */
export const roleText = (): string => prompt('system.role');
/** How the ceremony is conducted: "por voz" / "em texto". */
export const modeText = (): string => param('mode');
/** What the person's words are: a transcription (may have errors) or typed text. */
export const heardText = (): string => param('heard');
/** "Call" of the prompts that open a ceremony; "Conversa" while voice is off. */
export const callWord = (): string => param('call');
/** The opening of the answer prompt. */
export const answeredText = (): string => param('answered');
