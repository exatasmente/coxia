// The capture of the actions queue: the steps the app proposes and the person has still to answer.
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await waitForText(page, ['Hoje', 'Today']);
  // The screen's own navigation holds the queue: a button labelled "Ações" / "Actions".
  const entry = page.getByLabel(/Ações|Actions/).first();
  if (await entry.isVisible().catch(() => false)) await entry.click().catch(() => undefined);
  else {
    const byText = page.getByText(/^Ações$|^Actions$/).first();
    if (await byText.isVisible().catch(() => false)) await byText.click().catch(() => undefined);
  }
  await settle(page);
}
