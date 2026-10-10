// The capture of a ceremony in progress: the pre-daily of the seeded workspace, opened from the day.
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await waitForText(page, ['Hoje', 'Today']);
  // The day offers to start the ceremony of the moment; the seed's ceremony is the pre-daily.
  const start = page.getByRole('button', { name: /start (the )?|começar/i }).first();
  if (await start.isVisible().catch(() => false)) await start.click().catch(() => undefined);
  await waitForText(page, ['Pré-daily', 'Cerimônia', 'Ceremony', 'Conversa', 'Conversation']);
  // The ceremony draws a live turn clock: freeze it, so the picture is the same on every run.
  const timer = page.locator('.timer');
  if (await timer.first().isVisible().catch(() => false)) await timer.first().evaluate((el) => (el.style.visibility = 'hidden'));
  // The turn bar under it keeps the same width, but the clock that feeds it is a real one: hold the page's clock still.
  await page.clock.pauseAt(new Date('2026-06-15T09:41:00Z')).catch(() => undefined);
  await settle(page);
}
