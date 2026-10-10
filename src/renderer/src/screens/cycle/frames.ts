import type { ScreenFrameAnswer } from '../../../../shared/screen';
import type { Size } from './screenKeys';
import { jpegSrc } from './screenApi';

// What the viewer keeps of the answers to its frame reads, apart from the component so a test can read each state without a DOM.

export interface Frames {
  /** The latest picture as an address the page may show (a `data:` URL: the desktop's policy has no `blob:` for images). */
  src: string | null;
  /** The display's own size, which the pointer is mapped to. */
  screen: Size | null;
  /** Someone controls the screen (read from the answer, so the paired browser sees it too). */
  remote: boolean;
  /** The stage ended: the answer was `none`. */
  ended: boolean;
  /** The person holds the screen for a hand-off (#178): the answer was `held`, and no picture is served to this reader. */
  held: boolean;
  /** The last ask failed; it is tried again. */
  failed: boolean;
}

export const NO_FRAMES: Frames = { src: null, screen: null, remote: false, ended: false, held: false, failed: false };

/** What one answer changes: the fields to set, the sequence number to ask from next (null: unchanged) and whether to ask again (not once the screen is gone). */
export function framesFrom(answer: ScreenFrameAnswer): { next: Partial<Frames>; since: number | null; again: boolean } {
  switch (answer.state) {
    case 'none':
      return { next: { ended: true, remote: false, held: false, failed: false }, since: null, again: false };
    case 'held':
      // The picture the viewer holds is no longer the screen's: whatever comes after the hand-off is asked for afresh.
      return { next: { src: null, screen: null, remote: false, ended: false, held: true, failed: false }, since: 0, again: true };
    case 'same':
      return { next: { remote: answer.control, held: false, failed: false }, since: null, again: true };
    default:
      return { next: { src: jpegSrc(answer.jpeg), screen: answer.screen, remote: answer.control, held: false, failed: false }, since: answer.seq, again: true };
  }
}
