# 58 Say when a provider key has no budget left instead of "agent ended with success"

- Endereço: https://github.com/exatasmente/coxia/issues/58
- Estado: open
- Rótulos: bug, coxia
- Autor: exatasmente

## Descrição

## The problem

When the provider refuses a call because the key ran out of budget, the person never sees why. With a gateway key over its monthly limit, the SDK answered with an assistant message `API Error: 403 Key limit exceeded (monthly limit)` (prefixed "Failed to authenticate"), and a result whose subtype is `success` with no structured output. The app turns that into `agent ended with success` (`src/main/agents.ts`: `if (m.subtype !== 'success' || m.structured_output == null) throw new Error(\`agent ended with ${m.subtype}\`)`).

What one run's thread showed:

- `implement` failed with "agent ended with success";
- the retry failed the same way three seconds later;
- an `@agent` mention in the same thread failed with the same text.

The run was marked failed. Nothing pointed at the key, and every other run and ceremony on the same key kept failing, also without a reason.

## What you would like to happen

- **Keep the provider's error.** When a call ends with no structured output, the failure carries the error text the SDK or the server returned, masked the same way other outside text is. Never only the subtype.
- **Say "the key has no budget left" in plain words.** A quota or limit refusal (HTTP 402, a 403 whose body says limit or credit, a 429 that does not clear) is a reason of its own. The message names the provider and says the budget of its key ran out.
- **Do not spend retries on it.** A run that hits it waits, with that reason, instead of failing. The app does not start new stages or mentions on that provider until a call goes through again. The scheduler's sweep tries one call to find out, not one per run.
- **The same on the open engine,** for the same HTTP answers.

## Notes

- The SDK adds "Failed to authenticate" to the front of the gateway's message, so matching only on "authenticate" would send the person to fix a key that is fine.

## Comentários

(sem comentários)
