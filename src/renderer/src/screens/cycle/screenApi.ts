import { bytesToBase64 } from '../../../../shared/wire';
import type { ScreenControlAnswer, ScreenFrameAnswer, ScreenInput, ScreenInputAnswer } from '../../../../shared/screen';
import type { OpenScreenInfo } from '../../../../shared/browser';
import { api } from '../../api';

// The channels of an agent's live screen, all taking the screen's key (`run:<id>`, `call:<thread>:<agent>`). `runs:screen` is a read, open to the paired browser like the
// other run reads; `screen:*` are the desktop's alone (the main process refuses a paired browser), so the web build never calls them.

export const screenApi = {
  frame: (key: string, since: number, width: number) => api.invoke<ScreenFrameAnswer>('runs:screen', key, since, width),
  control: (key: string, on: boolean) => api.invoke<ScreenControlAnswer>('screen:control', key, on),
  // The open screens of a thread (or of the workspace), and the person's closing of one; both are open to a paired browser, like `runs:cancel`.
  list: (thread?: string) => api.invoke<OpenScreenInfo[]>('runs:screens', thread),
  close: (key: string) => api.invoke<boolean>('runs:screenClose', key),
  input: (key: string, events: readonly ScreenInput[]) => api.invoke<ScreenInputAnswer>('screen:input', key, events),
};

/**
 * The picture as an address the page's content security policy allows in both builds: a `data:` URL (the desktop's policy has no `blob:` for images). The bytes arrive as
 * a typed array from the window's bridge and as an ArrayBuffer from the paired browser's wire.
 */
export function jpegSrc(jpeg: Uint8Array | ArrayBuffer): string {
  return `data:image/jpeg;base64,${bytesToBase64(jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg))}`;
}
