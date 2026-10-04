// The Claude SDK path when a call ends with no structured output: the failure carries the provider's own text, and a refusal by the key's budget
// becomes a reason of its own that the runner can wait on, never a generic "agent ended with success".
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: string; options: Record<string, unknown> }[] = [];
let scripts: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
    calls.push({ prompt, options });
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) yield m;
    })();
  },
}));

import { askAgent, obj, str } from '../src/main/agents';
import { ProviderBudgetError } from '../src/main/engine/contract';
import { installEnvSecret, installLegacyConfig } from './helpers/config';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');

const init = (id: string) => ({ type: 'system', subtype: 'init', session_id: id });
const says = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = (subtype: string, id: string, structured?: unknown) => ({
  type: 'result',
  subtype,
  session_id: id,
  ...(structured === undefined ? {} : { structured_output: structured }),
});

const schema = obj({ fala: str });
const ask = () => askAgent<{ fala: string }>('deep', 'Pergunta original', schema, { maxTurns: 3 });

beforeEach(() => {
  calls.length = 0;
  scripts = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('a call that ends with no structured output', () => {
  it('carries the text the provider returned, not only the subtype', async () => {
    scripts = [[init('s1'), says('the gateway said: model overloaded, try later'), result('success', 's1')]];
    await expect(ask()).rejects.toThrow(/agent failed:.*model overloaded, try later/);
  });

  it('masks what came from outside before it reaches the failure', async () => {
    scripts = [[init('s1'), says('provider said no: Bearer abc.def.ghi'), result('success', 's1')]];
    let message = '';
    try {
      await ask();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('agent failed:');
    expect(message).not.toContain('abc.def.ghi');
  });
});

describe('a refusal by the key budget', () => {
  it('is a reason of its own, with the provider, and not the generic failure', async () => {
    scripts = [[init('s1'), says('Failed to authenticate. API Error: 403 Key limit exceeded (monthly limit)'), result('success', 's1')]];
    const error = await ask().catch((e) => e as Error);
    expect(error).toBeInstanceOf(ProviderBudgetError);
    expect((error as ProviderBudgetError).detail).toContain('Key limit exceeded');
    expect((error as ProviderBudgetError).provider).toBeTruthy();
    expect((error as Error).message).not.toContain('agent ended with success');
  });

  it('does not treat a 401 about the key as a budget refusal', async () => {
    scripts = [[init('s1'), says('API Error: 401 invalid api key'), result('success', 's1')]];
    const error = await ask().catch((e) => e as Error);
    expect(error).not.toBeInstanceOf(ProviderBudgetError);
    expect((error as Error).message).toContain('agent failed:');
  });

  it('never matches on the word "authenticate" alone, which the SDK writes in front of the gateway message', async () => {
    scripts = [[init('s1'), says('Failed to authenticate. The key was refused'), result('success', 's1')]];
    const error = await ask().catch((e) => e as Error);
    expect(error).not.toBeInstanceOf(ProviderBudgetError);
  });
});
