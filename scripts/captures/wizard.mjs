// The capture of the first-run setup wizard, at its models step: an empty data folder opens exactly here, so this capture
// also shows that. The runner points the app at a folder with no workspace in it for this feature (see run.mjs).
import { settle, waitForText } from './shared.mjs';

export async function capture({ page }) {
  await waitForText(page, ['Configuração', 'Setup', 'Bem-vindo', 'Welcome', 'Modelos', 'Models']);
  await settle(page);
  // The step the documentation shows is the models one: advance from the language step when the wizard offers to go on.
  const next = page.getByRole('button', { name: /Continuar|Continue/ }).first();
  if (await next.isVisible().catch(() => false)) await next.click().catch(() => undefined);
  await waitForText(page, ['Modelos', 'Models', 'Provedor', 'Provider']);
  await settle(page);
}
