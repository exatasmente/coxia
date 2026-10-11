/**
 * The capture of a ceremony in progress: the pre-daily of the seeded workspace, opened from the day. The screen shows the
 * agenda of the day, the card the ceremony is on and the sources the agent reads. The app asks a model for the agent's turn
 * and a capture runs no model, so the turn fields stay empty — the line of the app's activity is taken out of the picture,
 * because it names the provider of the workspace's configuration, which a public repository must not carry in a pixel.
 */
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await waitForText(page, ['Hoje', 'Today']);
  // The day offers to start the ceremony of the moment; the seed's ceremony is the one the workspace calls its own.
  const start = page.getByRole('button', { name: /Abertura do dia|Começar a|Start the/ }).first();
  if (await start.isVisible().catch(() => false)) await start.click().catch(() => undefined);
  await waitForText(page, ['Abertura do dia', 'Cerimônia', 'Ceremony', 'Conversa', 'Conversation'], 12000);
  // The activity line of a turn nobody prepared: it names where the model would come from, not a screen of the docs.
  await page.addStyleTag({ content: '.act { visibility: hidden; }' }).catch(() => undefined);
  // The ceremony draws a live turn clock: freeze it, so the picture is the same on every run (a stylesheet, never a call
  // into the window: the app closes the window the moment the capture ends).
  await page.addStyleTag({ content: '.timer { visibility: hidden; }' }).catch(() => undefined);
  // The turn bar under it keeps the same width, but the clock that feeds it is a real one: hold the page's clock still.
  await page.clock.pauseAt(new Date('2026-06-15T09:41:00Z')).catch(() => undefined);
  await settle(page);
}
