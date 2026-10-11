// The capture of the actions queue: the steps the app proposes and the person has still to answer. The screen is a state
// of the window, not an address in it: this build draws no screen from the address (`App.tsx` reads `location.search` for
// the boot hand-off only), so the capture walks the way the person does — the day's item that says how many actions wait
// — and waits for the queue's own heading. The sentences the app writes with its own vocabulary name the code host, which
// this workspace does not configure, so the vendor phrase is taken out of the window before the picture.
import { settle, waitForText } from './shared.mjs';

const HOST_WORDS = { 'pt-BR': 'provedor de código', en: 'the code host' };

export async function capture({ page, lang, drop }) {
  await waitForText(page, ['Hoje', 'Today']);
  // The item of the day that leads to the queue; its label is the app's own ("Ver ações" / "See actions").
  const lead = page.getByRole('button', { name: /Ver ações|See actions/ }).first();
  if (await lead.isVisible().catch(() => false)) await lead.click().catch(() => undefined);
  // The queue is the screen whose heading is its own; the release conflict is another screen, reached from its own item.
  await waitForText(page, ['Ações de release', 'Release actions'], 12000);
  await drop([HOST_WORDS[lang] ?? HOST_WORDS['pt-BR']]);
  await waitForText(page, ['Aguardando você', 'Waiting for you'], 12000);
  await settle(page);
}
