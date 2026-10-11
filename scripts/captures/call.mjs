/**
 * The capture of a ceremony in progress: the pre-daily of the seeded workspace, opened from the day. The screen shows the
 * agenda of the day, the card the ceremony is on and the agent's turn. The seed keeps the turns the agents prepared the day
 * before under the cards' fingerprints (`falas.json`), so the app serves them again and calls no model. The note of the
 * effects panel names the vendor's coding tool, which a public repository must not carry in a pixel, so that sentence is
 * taken out of the window before the picture.
 */
import { settle, waitForText } from './shared.mjs';

/** The ceremony draws the time elapsed since it opened: the window's clock stands still so every run draws the same. */
export const STILL_CLOCK = true;

/** What the seeded agent says it did on the first card of the agenda. */
const SEEDED_TURN = 'Ordered the actions by the answer the person gave';

const VENDOR_SENTENCES = {
  'pt-BR': 'Cada item vai para o Claude Code e espera o seu “sim”.',
  en: 'Each item goes to Claude Code and waits for your "yes".',
};

export async function capture({ page, lang, drop }) {
  await waitForText(page, ['Hoje', 'Today']);
  // The day offers to go back to the ceremony of the moment; the seed's ceremony is the one the workspace calls its own.
  const start = page.getByRole('button', { name: /Voltar à conversa|Back to the|Abertura do dia|Começar a|Start the/ }).first();
  if (await start.isVisible().catch(() => false)) await start.click().catch(() => undefined);
  await waitForText(page, ['Abertura do dia', 'Cerimônia', 'Ceremony', 'Conversa', 'Conversation'], 12000);
  // The turn served from the seed's saved turns: the capture waits for it instead of photographing an empty one.
  // The seeded turn of the card on screen (restored with the ceremony, or served again from the saved turns). A ceremony whose
  // agent was called instead would draw a failure that names the model vendor: the capture stops there.
  const served = await waitForText(page, [SEEDED_TURN, 'Sem mudança desde', 'No change since'], 12000);
  if (!served) throw new Error('the ceremony did not serve the seeded turns: the agent would be called, and the capture runs no model');
  await settle(page);
  if (await page.getByText(/llm\./).first().isVisible().catch(() => false)) throw new Error('an agent of the ceremony failed and the screen names its provider: the picture is not taken');
  await drop([VENDOR_SENTENCES[lang] ?? VENDOR_SENTENCES['pt-BR']]);
  await settle(page);
}
