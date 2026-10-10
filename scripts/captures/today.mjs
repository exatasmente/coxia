// The capture of the Today screen: the cards of the seeded workspace, in the language of this capture.
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await waitForText(page, ['Hoje', 'Today', 'O dia']);
  await settle(page);
}
