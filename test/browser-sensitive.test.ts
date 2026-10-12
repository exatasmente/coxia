import { describe, expect, it } from 'vitest';
import { sensitiveCategory, sensitiveTarget } from '../src/main/browser/sensitive';

describe('the four categories always held', () => {
  it.each([
    ['Pagar agora', 'payment'],
    ['Submit payment', 'payment'],
    ['Enviar pagamento', 'payment'],
    ['Place order', 'payment'],
    ['Check out', 'payment'],
    ['Comprar', 'payment'],
    ['Enviar mensagem', 'people'],
    ['Send', 'people'],
    ['Compartilhar', 'people'],
    ['Invite a member', 'people'],
    ['Password', 'secret'],
    ['Nova senha', 'secret'],
    ['API token', 'secret'],
    ['Card number', 'card'],
    ['Número do cartão', 'card'],
    ['CVV', 'card'],
  ] as const)('reads "%s" as %s', (text, category) => {
    expect(sensitiveCategory(text)).toBe(category);
  });

  it.each(['Salvar rascunho', 'Save draft', 'Delete', 'Publish', 'Next', 'Go', ''])('leaves "%s" to the policy', (text) => {
    expect(sensitiveCategory(text)).toBeNull();
  });

  it('ignores case and accents', () => {
    expect(sensitiveCategory('CARTÃO DE CRÉDITO')).toBe('card');
    expect(sensitiveCategory('pAgAmEnTo')).toBe('payment');
  });

  it('reads a password field by its type, and an element by any of its names', () => {
    expect(sensitiveTarget({ name: 'Field', probe: { tag: 'input', type: 'password', texts: [] } } as never)).toBe('secret');
    expect(sensitiveTarget({ name: 'Confirm', probe: { tag: 'button', texts: ['Pay now'] } } as never)).toBe('payment');
    expect(sensitiveTarget({ name: 'Save draft', probe: { tag: 'button', texts: [] } } as never)).toBeNull();
    expect(sensitiveTarget(null)).toBeNull();
  });
});
