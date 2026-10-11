// The capture of the Today screen: the cards of the seeded workspace, in the language of this capture. The sentences the
// app writes with its own vocabulary name the code host, which this workspace does not configure, so the vendor phrase is
// taken out of the window before the picture (a public repository must not carry it in a pixel).
import { settle, waitForText } from './shared.mjs';

const HOST_WORDS = { 'pt-BR': 'provedor de código', en: 'the code host' };

export async function capture({ page, lang, drop }) {
  await waitForText(page, ['Hoje', 'Today', 'O dia']);
  await drop([HOST_WORDS[lang] ?? HOST_WORDS['pt-BR']]);
  await settle(page);
}
