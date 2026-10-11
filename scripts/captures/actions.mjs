// The capture of the actions queue: the steps the app proposes and the person has still to answer. The queue is reached by its
// own address (`#acoes`), because the navigation label names several entries and the capture landed on the release conflict.
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await waitForText(page, ['Hoje', 'Today']);
  await page.goto(`${page.url().split('#')[0]}#acoes`);
  // The queue is the screen whose heading is its own; the release conflict shares the address only while a conflict is open.
  await waitForText(page, ['Ações de release', 'Release actions'], 12000);
  await waitForText(page, ['Aguardando você', 'Waiting for you'], 12000);
  await settle(page);
}
