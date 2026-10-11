import type { SensitiveCategory } from '../../shared/browser';
import type { TargetInfo } from './probe';

// The four categories of step no screen step approval lets run without asking (#269): a payment, a sending to people, a secret, card data. It is a list of its own, apart from
// the irreversible words of `classify.ts`, because that list mixes paying and sending with saving and deleting, which a policy may let through. Like that list it is a heuristic
// over names, in English and Brazilian Portuguese, and conservative: a name that may be one of the four is taken as one. A control named "Go" that pays is not caught, and
// neither is a word in a language the table lacks; the docs say so. A password field is told by its type, read by the app from the page; the `autocomplete` of a card field is
// not read.

const TABLE: Readonly<Record<SensitiveCategory, readonly string[]>> = {
  payment: [
    'pay pays paying payment payments',
    'buy buys buying',
    'purchase purchases purchasing',
    'order orders ordering',
    'checkout',
    'transfer transfers transferring',
    'pagar pague paga pagando pagamento pagamentos',
    'comprar compre compra comprando',
    'pedido pedidos',
    'transferir transfira transfere transferindo',
  ],
  people: [
    'send sends sending',
    'share shares sharing',
    'post posts posting',
    'invite invites inviting',
    'reply replies replying',
    'forward forwards forwarding',
    'email emails',
    'message messages',
    'enviar envie envia enviando',
    'compartilhar compartilhe compartilha compartilhando',
    'postar poste postando',
    'convidar convide convida convidando',
    'responder responda responde respondendo',
    'encaminhar encaminhe encaminha encaminhando',
    'mensagem mensagens',
  ],
  secret: ['password passwords passcode', 'token tokens', 'secret secrets', 'otp', 'senha senhas', 'segredo segredos'],
  card: ['card cards', 'cvv cvc', 'credit debit', 'cartao cartoes', 'credito debito'],
};

// Two words together that name a payment the single words do not.
const PHRASES: readonly (readonly [string, string])[] = [
  ['check', 'out'],
  ['place', 'order'],
];

// The order a name is read in when it carries words of two categories ("send payment" is a payment).
const ORDER: readonly SensitiveCategory[] = ['payment', 'card', 'secret', 'people'];

const WORDS: ReadonlyMap<SensitiveCategory, ReadonlySet<string>> = new Map(ORDER.map((c) => [c, new Set(TABLE[c].flatMap((line) => line.split(' ')))]));

const tokens = (text: string): string[] => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The category a name or a sentence falls in, or null. Pure over text, so the table test pins the list. */
export function sensitiveCategory(text: string): SensitiveCategory | null {
  const words = tokens(text);
  if (words.some((w, i) => PHRASES.some(([a, b]) => w === a && words[i + 1] === b))) return 'payment';
  for (const category of ORDER) if (words.some((w) => WORDS.get(category)?.has(w))) return category;
  return null;
}

/** The category of the element a step acts on: a password field by its type, and every name the app read of it. */
export function sensitiveTarget(t: TargetInfo | null | undefined): SensitiveCategory | null {
  if (!t) return null;
  if (t.probe?.tag === 'input' && t.probe.type === 'password') return 'secret';
  for (const name of [t.name, ...(t.probe?.texts ?? [])]) {
    if (!name) continue;
    const c = sensitiveCategory(name);
    if (c) return c;
  }
  return null;
}
