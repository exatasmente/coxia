/**
 * The capture of the setup assistant, at its models step: an empty data folder opens exactly here, so this capture also
 * shows that. The assistant opens with the model provider the app ships with, whose label, its id, its address and the
 * model names it offers belong to a vendor and must not reach a public picture. Every part of the screen carrying one is
 * taken out before the shot, and the step itself stays: its own headings, the empty provider list and the frame the
 * person adds a provider in.
 */
import { settle, waitForText } from './shared.mjs';

/** What the app's own default provider puts on the screen: the vendor's label, its id, its address and its model names. */
const VENDOR = {
  'pt-BR': ['Anthropic (chave de API)', 'anthropic', 'api.anthropic.com', 'haiku', 'sonnet', 'opus', 'Claude'],
  en: ['Anthropic (API key)', 'anthropic', 'api.anthropic.com', 'haiku', 'sonnet', 'opus', 'Claude'],
};

/**
 * The step with nothing configured, as an empty data folder would open it if the app shipped with no provider: the two
 * sentences that name the vendor and the provider's own block and fields are taken out, and the sentence about the step
 * the person has to take stays. The frame that adds a provider is left as it is.
 */
const CLEAR = {
  'pt-BR': [
    'Sem um provedor de modelo nenhum agente roda: é neste passo que o app é configurado para falar com um.',
    'Nenhum provedor de modelo está configurado: adicione um para que os agentes possam falar.',
    'O Coxia usa chave de API ou as credenciais da sua nuvem.',
  ],
  en: [
    'With no model provider no agent runs: this is the step where the app is set up to talk to one.',
    'No model provider is configured: add one so the agents can talk.',
    'Coxia uses an API key or your cloud credentials.',
  ],
};

/** Whether the models step, with its provider cards, is drawn. It is drawn from the configuration a moment after the step appears. */
const ready = (phrases) => [...document.querySelectorAll('body *')].some((n) => phrases.some((p) => n.textContent.includes(p)));

export async function capture({ page, lang }) {
  const cut = VENDOR[lang] ?? VENDOR['pt-BR'];
  const clear = CLEAR[lang] ?? CLEAR['pt-BR'];
  await waitForText(page, ['Configuração', 'Setup', 'Bem-vindo', 'Welcome', 'Modelos', 'Models']);
  await settle(page);
  // A first run with no configuration follows the computer's language, and this capture runs on a Portuguese one: the
  // English image is asked for on the step that names it, the way the person does, before anything else is read.
  if (lang === 'en') {
    const other = page.getByRole('button', { name: /English|Inglês/ }).first();
    if (await other.isVisible().catch(() => false)) await other.click().catch(() => undefined);
    await waitForText(page, ['Language and name', 'Models', 'Setup'], 10000);
  }
  await settle(page);
  // The step the documentation shows is the models one: advance from the language step when the wizard offers to go on.
  const next = page.getByRole('button', { name: /Continuar|Continue/ }).first();
  if (await next.isVisible().catch(() => false)) await next.click().catch(() => undefined);
  await page.waitForFunction(ready, cut, { timeout: 15000 }).catch(() => undefined);
  await settle(page);
  // The two notes the step draws above the providers are written by the app about its own default provider: one names the
  // vendor and the other is about it, and the step draws both again the moment the window draws. They go by a rule of the
  // window, and not by a change of the page, so what is drawn stays as it is drawn.
  await page.addStyleTag({ content: '.wz-note-info { display: none !important; }' }).catch(() => undefined);
  await settle(page);
  await page.evaluate(
    ([phrases, notes]) => {
      const holds = (node) => phrases.some((p) => node.textContent.includes(p));
      const drop = (node) => {
        if (!node || node.style.visibility === 'hidden') return;
        node.style.visibility = 'hidden';
      };
      // The notes of the step are written by the app about its own default provider: the ones that name the vendor go
      // whole, and the sentence about the step the person has to take (the one the app draws with no provider) stays.
      for (const note of document.querySelectorAll('.wz-note')) {
        if (notes.some((n) => note.textContent.includes(n.slice(0, 24)))) continue;
        if (holds(note)) note.remove();
      }
      // The provider card and the fields the person answers: the deepest box of each goes, and the parts of the step that
      // carry no name of a vendor (the headings, the button that adds a provider) are left where they are.
      for (const box of document.querySelectorAll('.wz-card-title, .small.muted.wz-wrap-anywhere, .wz-actions, .wz-pool-row, .wz-note, .wz-hint, .hint, .small')) {
        if (holds(box) && box.childElementCount <= 2) drop(box);
      }
      // The field of a model, taken out with the list it offers: the list holds the vendor's model names.
      for (const input of document.querySelectorAll('input[list]')) {
        if (input.getAttribute('list')?.startsWith('models-')) {
          drop(input);
          const label = input.closest('label') ?? (input.id ? document.querySelector(`label[for="${input.id}"]`) : null);
          if (label) drop(label);
        }
      }
      for (const list of document.querySelectorAll('datalist')) if ([...list.children].some((o) => phrases.some((p) => o.textContent.includes(p)))) list.remove();
      // The roles are named by the provider the pool holds: the sentence goes, the heading of the role stays.
      for (const span of document.querySelectorAll('span')) if (holds(span) && span.childElementCount === 0) drop(span);
      // A select whose options are the vendor's id alone would open on the vendor's name: the step is drawn with nothing
      // configured, so the sentence that names the role stays and the choice of a model draws no name.
      for (const select of document.querySelectorAll('select')) {
        if ([...select.options].some((o) => phrases.some((p) => o.textContent.includes(p)))) drop(select);
      }
      // The provider the app ships with leaves an empty card behind: the frame that held it, with the buttons that act on
      // it, is not what an empty data folder opens.
      for (const box of document.querySelectorAll('.wz-actions, li')) if (holds(box) && box.childElementCount <= 4) drop(box);
      const emptyCard = [...document.querySelectorAll('.wz-card-item, .wz-card')].find((box) => box.childElementCount && [...box.children].every((c) => holds(c) || c.style.visibility === 'hidden'));
      if (emptyCard) drop(emptyCard);
      // The card of a provider leaves the room it held: the box drawn around an empty list goes with it.
      const emptyBox = [...document.querySelectorAll('.wz-card, .wz-cards, ul, div')].find((box) => !box.textContent.trim() && box.getBoundingClientRect().height > 80);
      if (emptyBox) drop(emptyBox);
      // The sentence of the step that says the person has to add a provider is the app's own; it is drawn where the notes
      // were, so the step reads as a first run with nothing configured and not as one with a provider left out.
      const stack = document.querySelector('.wz-stack');
      if (stack && notes[1]) stack.insertAdjacentHTML('afterbegin', `<div class="wz-note wz-note-info">${notes[1]}</div>`);
    },
    [cut, clear],
  );
  await settle(page);
}
