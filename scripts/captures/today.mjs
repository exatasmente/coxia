// The capture of the Today screen: the cards of the seeded workspace, in the language of this capture. The workspace
// configures no code host, so the app names none: it says "the code host", which is the words of the screen.
//
// The panel of the day's time measures the ceremony in progress up to the moment its file was last written, and the app
// writes it again on opening with the computer's real time: two runs would draw two different durations, so the panel is
// taken out of the window before the picture.
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await waitForText(page, ['Hoje', 'Today', 'O dia']);
  await page.evaluate(() => document.querySelector('section.tempo')?.remove());
  await settle(page);
}
