import { bytesToBase64 } from '../../../../shared/wire';
import type { HandoffAnswer } from '../../../../shared/handoff';
import type { ScreenControlAnswer, ScreenFrameAnswer, ScreenInput, ScreenInputAnswer } from '../../../../shared/screen';
import type { AskDecision, OpenScreenInfo } from '../../../../shared/browser';
import { api } from '../../api';

// The channels of an agent's live screen, all taking the screen's key (`run:<id>`, `call:<thread>:<agent>`). `runs:screen` is a read, open to the paired browser like the
// other run reads; `screen:*` are the desktop's alone (the main process refuses a paired browser), so the web build never calls them.

export type AskAnswer = { ok: true } | { ok: false; reason: 'decision' | 'gone' };

export const screenApi = {
  frame: (key: string, since: number, width: number) => api.invoke<ScreenFrameAnswer>('runs:screen', key, since, width),
  control: (key: string, on: boolean) => api.invoke<ScreenControlAnswer>('screen:control', key, on),
  // The open screens of a thread (or of the workspace), and the person's closing of one; both are open to a paired browser, like `runs:cancel`.
  list: (thread?: string) => api.invoke<OpenScreenInfo[]>('runs:screens', thread),
  close: (key: string) => api.invoke<boolean>('runs:screenClose', key),
  // Stops one answer of an agent in a conversation and leaves its screen open; false: it has none running (or it still waits its turn).
  stop: (thread: string, agent: string) => api.invoke<boolean>('runs:callStop', thread, agent),
  // The person's answer to a step the app holds or a confirmation an agent asked for: an external effect, so a paired browser needs the switch.
  answer: (ask: string, decision: AskDecision, note?: string) => api.invoke<AskAnswer>('runs:screenAnswer', ask, decision, note),
  // The hand-off of the screen (#178). Taking it (after the warning), giving it back and the picture of the screen the person holds are the desktop's alone; declining is open to a
  // paired browser, since a person away from the computer would otherwise leave the agent waiting.
  handoffTake: (key: string, ask: string) => api.invoke<HandoffAnswer>('screen:handoffTake', key, ask),
  handoffGive: (key: string) => api.invoke<HandoffAnswer>('screen:handoffGive', key),
  handoffFrame: (key: string, since: number, width: number) => api.invoke<ScreenFrameAnswer>('screen:handoffFrame', key, since, width),
  handoffDecline: (ask: string) => api.invoke<HandoffAnswer>('runs:handoffDecline', ask),
  input: (key: string, events: readonly ScreenInput[]) => api.invoke<ScreenInputAnswer>('screen:input', key, events),
};

/**
 * The picture as an address the page's content security policy allows in both builds: a `data:` URL (the desktop's policy has no `blob:` for images). The bytes arrive as
 * a typed array from the window's bridge and as an ArrayBuffer from the paired browser's wire.
 */
export function jpegSrc(jpeg: Uint8Array | ArrayBuffer): string {
  return `data:image/jpeg;base64,${bytesToBase64(jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg))}`;
}
