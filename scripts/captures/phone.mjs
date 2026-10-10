// The capture of the paired phone: the app's own web mode, in a window 390 px wide, so the phone layout draws.
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForText(page, ['Celular', 'Phone', 'Pareado', 'Paired']);
  await settle(page);
}
